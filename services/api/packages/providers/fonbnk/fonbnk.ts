import { createHash, createHmac } from "node:crypto";
import { constantTimeEqual } from "../../webhooks/hmac";
import { ProviderError } from "../errors";
import { createProviderHttp } from "../http";
import { jsonReader, type JsonObject } from "../json";
import {
  ASSET_DECIMALS,
  FIAT_DECIMALS,
  InvalidAmountError,
  toDecimalString,
  toUnits,
  type Rounding,
} from "../money";
import type {
  AdapterDeps,
  Asset,
  Capabilities,
  Chain,
  Corridor,
  Country,
  CreateOrderRequest,
  Fee,
  FiatCurrency,
  Institution,
  OrderStatus,
  OrderSnapshot,
  ProviderAdapter,
  ProviderQuote,
  QuoteAmount,
  QuoteRequest,
  SourceAsset,
} from "../types";

// Sources: services/Project MD/EXTERNAL_ADAPTERS/FONBNK.md, verified against docs.fonbnk.com (Merchant API v2).
export const FONBNK_BASE_URL = {
  production: "https://api.fonbnk.com",
  sandbox: "https://sandbox-api.fonbnk.com",
};
export const FONBNK_SIGNATURE_HEADER = "x-signature";

export type FonbnkEnvironment = keyof typeof FONBNK_BASE_URL;

// Create order requires an end user. Each sender gets an alias on this email's domain; the email itself is the fallback.
export type FonbnkEndUser = { email: string; ip: string };

export type FonbnkOptions = {
  clientId: string;
  signatureSecret: string;
  webhookSecrets: readonly string[];
  environment: FonbnkEnvironment;
  endUser: FonbnkEndUser;
  // fliq's own contact number in international digits, sent only when a quote requires a phone we were not given.
  defaultPhone?: string;
  webhookUrl?: string;
  deps: AdapterDeps;
  baseUrl?: string;
  maxConcurrent?: number;
};

// Fonbnk only starts checking a crypto deposit once it is told the transaction hash (POST /api/v2/order/confirm).
export type FonbnkAdapter = ProviderAdapter & {
  confirmFunding(providerOrderId: string, txHash: string): Promise<OrderSnapshot>;
};

type Route = { paymentChannel: "bank" | "mobile_money"; carrierCode?: string };

type Operation = "quote" | "createOrder" | "institutions" | "verifyAccount";

type QuoteField = {
  key: string;
  required: boolean;
  defaultValue?: string;
  options: { label: string; value: string }[];
};

type StoredQuote = { fields: QuoteField[]; amount?: QuoteAmount; expiresAt: number };

// Ghana mobile money needs the carrier at quote time and the docs disagree on which carriers pay out, so it waits for sandbox.
const ROUTES: Record<string, Route> = {
  "NG:bank": { paymentChannel: "bank" },
  "KE:bank": { paymentChannel: "bank" },
  "KE:mobile_money": { paymentChannel: "mobile_money", carrierCode: "ke_safaricom" },
};

const NETWORKS: Partial<Record<Chain, { network: string; assets: readonly Asset[] }>> = {
  base: { network: "BASE", assets: ["USDC"] },
  polygon: { network: "POLYGON", assets: ["USDC", "USDT"] },
  solana: { network: "SOLANA", assets: ["USDC", "USDT"] },
};

const MPESA: Institution = { code: "ke_safaricom", name: "M-PESA", type: "mobile_money" };

const ACCOUNT_FORMATS: Partial<Record<Country, RegExp>> = { NG: /^\d{10}$/, KE: /^\d{6,20}$/ };

// A quote is only used to read the bank list, so its amount just has to clear every corridor's minimum.
const INSTITUTIONS_PROBE_UNITS = 10_000_000n;
const BANK_LIST_TTL_MS = 10 * 60 * 1000;

const LIMIT_ERRORS: Record<string, string> = {
  AMOUNT_BELOW_MINIMUM: "amount below the minimum",
  AMOUNT_ABOVE_MAXIMUM: "amount above the maximum",
};

export function createFonbnkAdapter(options: FonbnkOptions): FonbnkAdapter {
  const webhookSecrets = options.webhookSecrets.map((secret) => secret.trim()).filter(Boolean);
  const signingKey = Buffer.from(options.signatureSecret, "base64");
  const now = () => (options.deps.now ? options.deps.now() : new Date()).getTime();
  const http = createProviderHttp({
    provider: "fonbnk",
    baseUrl: options.baseUrl ?? FONBNK_BASE_URL[options.environment],
    maxConcurrent: options.maxConcurrent ?? 4,
    ...(options.deps.fetch ? { fetch: options.deps.fetch } : {}),
    // Signs the path and query exactly as sent; the body is not signed. A fresh timestamp on every attempt.
    authHeaders: ({ pathWithQuery }) => {
      const timestamp = String(Date.now());
      const signature = createHmac("sha256", signingKey)
        .update(`${timestamp}:${pathWithQuery}`)
        .digest("base64");
      return { "x-client-id": options.clientId, "x-timestamp": timestamp, "x-signature": signature };
    },
  });

  const quotes = new Map<string, StoredQuote>();
  const bankLists = new Map<Country, { value: Promise<Institution[]>; expiresAt: number }>();
  const alertedInvalid = new Set<string>();

  const sources: SourceAsset[] = Object.entries(NETWORKS).flatMap(([chain, entry]) =>
    (entry?.assets ?? []).map((asset) => ({ asset, chain: chain as Chain })),
  );

  const capabilities: Capabilities = {
    provider: "fonbnk",
    custody: "per_order_address",
    corridors: [
      { country: "NG", currency: "NGN", payoutType: "bank" },
      { country: "KE", currency: "KES", payoutType: "bank" },
      { country: "KE", currency: "KES", payoutType: "mobile_money" },
    ],
    sources,
    limits: {},
    sandbox: options.environment === "sandbox",
    // A deposit is matched only by the hash we confirm, and only a 1Click hop tells us that hash.
    funding: { direct: false, hop: true },
  };

  function routeFor(corridor: Corridor, operation: Operation): Route {
    const route = ROUTES[`${corridor.country}:${corridor.payoutType}`];
    if (!route) throw new ProviderError("fonbnk", operation, "not_supported", `corridor ${corridor.country}`);
    return route;
  }

  function currencyCode(source: SourceAsset, operation: Operation): string {
    const entry = NETWORKS[source.chain];
    if (!entry?.assets.includes(source.asset)) {
      throw new ProviderError("fonbnk", operation, "not_supported", `${source.asset} on ${source.chain}`);
    }
    return `${entry.network}_${source.asset}`;
  }

  // Exactly one leg carries the amount: the deposit for a send amount, the payout for a receive amount.
  function legs(corridor: Corridor, source: SourceAsset, quoted: QuoteAmount, operation: Operation) {
    const route = routeFor(corridor, operation);
    const deposit = {
      paymentChannel: "crypto",
      currencyType: "crypto",
      currencyCode: currencyCode(source, operation),
    };
    const payout = {
      paymentChannel: route.paymentChannel,
      currencyType: "fiat",
      currencyCode: corridor.currency,
      countryIsoCode: corridor.country,
      ...(route.carrierCode ? { carrierCode: route.carrierCode } : {}),
    };
    if (quoted.side === "send") {
      const amount = Number(toDecimalString(quoted.units, ASSET_DECIMALS[source.asset]));
      return { deposit: { ...deposit, amount }, payout };
    }
    // Fiat amounts are whole units on these corridors, so round up to never pay less than asked.
    const amount = Number(ceilToWhole(quoted.minorUnits, FIAT_DECIMALS[corridor.currency]));
    return { deposit, payout: { ...payout, amount } };
  }

  // Fonbnk sends amounts as JSON numbers in major units.
  function amount(
    read: ReturnType<typeof jsonReader>,
    record: JsonObject,
    key: string,
    decimals: number,
    rounding: Rounding = "exact",
  ): bigint {
    const value = record[key];
    if (typeof value !== "number" && typeof value !== "string") throw read.fail(`${key} is missing`);
    try {
      return toUnits(value, decimals, rounding);
    } catch (error) {
      if (error instanceof InvalidAmountError) throw read.fail(`${key} is not a valid amount`);
      throw error;
    }
  }

  function fees(
    read: ReturnType<typeof jsonReader>,
    cashout: JsonObject,
    unit: Asset | FiatCurrency,
    decimals: number,
  ) {
    return read.array(cashout.chargedFees ?? [], "chargedFees").map((entry): Fee => {
      const fee = read.object(entry, "chargedFee");
      return {
        kind: fee.recipient === "blockchain" ? "network" : "provider",
        amount: amount(read, fee, "amount", decimals, "down"),
        unit,
      };
    });
  }

  async function requestQuote(request: Omit<QuoteRequest, "quoteId">, operation: Operation) {
    const response = await http.request({
      operation,
      method: "POST",
      path: "/api/v2/quote",
      body: legs(request.corridor, request.source, request.amount, operation),
      acceptStatuses: [404],
    });
    if (response.status === 404) throw quoteRefused(response.body, operation);
    return jsonReader("fonbnk", operation).object(response.body, "body");
  }

  function quoteRefused(body: unknown, operation: Operation): ProviderError {
    const record = typeof body === "object" && body !== null ? (body as JsonObject) : {};
    const errorCode = typeof record.errorCode === "string" ? record.errorCode : "unknown";
    const limit = LIMIT_ERRORS[errorCode];
    if (limit) {
      const details = typeof record.details === "object" && record.details !== null ? record.details : {};
      const { min, max, currencyCode: currency } = details as JsonObject;
      const range = `${errorCode}: min ${String(min)} max ${String(max)} ${String(currency)}`;
      return new ProviderError("fonbnk", operation, "not_supported", limit, 404, range);
    }
    // errors.md: ROUTE_NOT_AVAILABLE is the only 404 worth retrying.
    const kind = errorCode === "ROUTE_NOT_AVAILABLE" ? "unavailable" : "rejected";
    return new ProviderError("fonbnk", operation, kind, `quote refused: ${errorCode}`, 404);
  }

  function quoteFields(read: ReturnType<typeof jsonReader>, body: JsonObject): QuoteField[] {
    const payout = read.object(body.payout, "payout");
    return read.array(payout.fieldsToCreateOrder ?? [], "fieldsToCreateOrder").map((entry) => {
      const field = read.object(entry, "field");
      const defaultValue = read.optionalString(field, "defaultValue");
      return {
        key: read.string(field, "key"),
        required: field.required === true,
        ...(defaultValue ? { defaultValue } : {}),
        options: read.array(field.options ?? [], "options").map((item) => {
          const option = read.object(item, "option");
          return { label: read.string(option, "label"), value: read.string(option, "value") };
        }),
      };
    });
  }

  function remember(quoteId: string, stored: StoredQuote): void {
    for (const [id, entry] of quotes) if (entry.expiresAt <= now()) quotes.delete(id);
    quotes.set(quoteId, stored);
  }

  // The quote that prices the order also fixes its recipient fields and bank codes. After a restart it is asked again.
  async function storedQuote(request: CreateOrderRequest): Promise<Omit<StoredQuote, "expiresAt">> {
    const quoteId = request.quote.providerQuoteId;
    const stored = quoteId ? quotes.get(quoteId) : undefined;
    if (stored && stored.expiresAt > now()) return stored;
    const body = await requestQuote(
      {
        corridor: request.corridor,
        source: request.source,
        amount: { side: "send", units: request.quote.sendUnits },
      },
      "createOrder",
    );
    return { fields: quoteFields(jsonReader("fonbnk", "createOrder"), body) };
  }

  function toStatus(status: string, order: JsonObject): OrderStatus | null {
    switch (status) {
      case "deposit_awaiting":
        return { status: "awaiting_deposit" };
      // Means Fonbnk is checking the transaction we confirmed, not that it has accepted it.
      case "deposit_validating":
        return { status: "deposit_received" };
      case "deposit_successful":
      case "payout_pending":
      // Not final: Fonbnk retries the payout or moves to a refund.
      case "payout_failed":
        return { status: "processing" };
      case "payout_successful": {
        const fiatReference = transactionMeta(order.payout).paymentChannelAdditionalInfo;
        return typeof fiatReference === "string" && fiatReference !== ""
          ? { status: "paid", fiatReference }
          : { status: "paid" };
      }
      case "refund_initiated":
      case "refund_pending":
      // Not final: a retry re-enters at refund_initiated.
      case "refund_failed":
        return { status: "refunding" };
      case "refund_successful": {
        const refundTxHash = transactionMeta(order.refund).transactionHash;
        return typeof refundTxHash === "string" && refundTxHash !== ""
          ? { status: "refunded", refundTxHash }
          : { status: "refunded" };
      }
      // Fonbnk still accepts a late deposit on these, so they are failures only while nothing was sent.
      case "deposit_expired":
      case "deposit_canceled":
        return { status: "failed", code: "deposit_expired", retryable: true };
      // Our transfer was delivered but Fonbnk would not match it. Support can walk this back, and where the funds go
      // is undocumented, so a person has to look.
      case "deposit_invalid":
        alertInvalidDeposit(order);
        return { status: "refunding" };
      default:
        return null;
    }
  }

  function alertInvalidDeposit(order: JsonObject): void {
    const id = typeof order._id === "string" ? order._id : "unknown";
    if (alertedInvalid.has(id)) return;
    alertedInvalid.add(id);
    options.deps.alert({
      provider: "fonbnk",
      kind: "unmappable_status",
      detail: `deposit_invalid on order ${id}: check the deposit and where Fonbnk returns it`,
    });
  }

  function unmappable(operation: "getOrder" | "parseWebhook", value: string): ProviderError {
    options.deps.alert({ provider: "fonbnk", kind: "unmappable_status", detail: `${operation} ${value}` });
    return new ProviderError("fonbnk", operation, "unmappable_status", value);
  }

  function snapshot(order: JsonObject): OrderSnapshot {
    const read = jsonReader("fonbnk", "getOrder");
    const status = read.string(order, "status");
    const mapped = toStatus(status, order);
    if (!mapped) throw unmappable("getOrder", status);
    const reference = read.optionalString(order, "merchantOrderParams");
    return { providerOrderId: read.string(order, "_id"), ...(reference ? { reference } : {}), ...mapped };
  }

  function refuse(detail: string): ProviderError {
    return new ProviderError("fonbnk", "createOrder", "rejected", detail);
  }

  // Bank codes differ per routing provider (bank-transfer.md), so the bank is found by name in the order's own quote.
  async function bankCodeFor(request: CreateOrderRequest, field: QuoteField): Promise<string> {
    const banks = await cachedBanks(request.corridor);
    const label = banks.find((bank) => bank.code === request.recipient.institutionCode)?.name;
    const matches = label ? field.options.filter((option) => sameName(option.label, label)) : [];
    const match = matches.length === 1 ? matches[0] : undefined;
    if (!match) throw refuse("bank not offered by this quote");
    return match.value;
  }

  async function recipientFields(
    request: CreateOrderRequest,
    route: Route,
    fields: QuoteField[],
  ): Promise<Record<string, string>> {
    const { recipient, corridor } = request;
    const phone = route.paymentChannel === "mobile_money" ? recipient.accountNumber : recipient.phone;
    const phoneFor = (field: QuoteField): string | undefined => {
      if (phone) return internationalPhone(phone, corridor);
      return field.required ? options.defaultPhone?.replace(/\D/g, "") : undefined;
    };
    const values: Record<string, string> = {};
    for (const field of fields) {
      let value: string | undefined;
      switch (field.key) {
        case "phoneNumber":
          value = phoneFor(field);
          break;
        case "bankCode":
          value = await bankCodeFor(request, field);
          break;
        case "bankAccountNumber":
          value = recipient.accountNumber;
          break;
        case "bankAccountHolderName":
        case "fullName":
          value = recipient.accountName || undefined;
          break;
        case "carrierCode":
          value = route.carrierCode;
          break;
      }
      value = value ?? field.defaultValue;
      if (value) values[field.key] = value;
      else if (field.required) throw refuse(`no value for required field ${field.key}`);
    }
    return values;
  }

  function endUserEmail(request: CreateOrderRequest): string {
    const pseudonym = request.sender?.pseudonym.toLowerCase() ?? "";
    const domain = options.endUser.email.split("@")[1];
    if (!/^[0-9a-f]{24,}$/.test(pseudonym) || !domain) return options.endUser.email;
    return `u-${pseudonym.slice(0, 24)}@${domain}`;
  }

  async function cancelQuietly(orderId: string): Promise<void> {
    await http
      .request({ operation: "createOrder", method: "POST", path: "/api/v2/order/cancel", body: { orderId } })
      .catch(() => undefined);
  }

  async function findOrder(
    query: { orderId: string } | { orderParams: string },
  ): Promise<OrderSnapshot | null> {
    const response = await http.request({
      operation: "getOrder",
      method: "GET",
      path: "/api/v2/order",
      query,
      acceptStatuses: [404],
    });
    if (response.status === 404) return null;
    return snapshot(jsonReader("fonbnk", "getOrder").object(response.body, "body"));
  }

  function bankCorridor(country: Country): Corridor | undefined {
    return capabilities.corridors.find(
      (corridor) => corridor.country === country && corridor.payoutType === "bank",
    );
  }

  return {
    id: "fonbnk",

    capabilities: () => capabilities,

    async quote(request): Promise<ProviderQuote> {
      const read = jsonReader("fonbnk", "quote");
      const body = await requestQuote(request, "quote");
      const currency = request.corridor.currency;
      const asset = request.source.asset;
      const deposit = read.object(read.object(body.deposit, "deposit").cashout, "deposit.cashout");
      const payout = read.object(read.object(body.payout, "payout").cashout, "payout.cashout");
      const rate = payout.exchangeRate;
      if (typeof rate !== "number" && typeof rate !== "string") throw read.fail("exchangeRate is missing");
      const providerQuoteId = read.string(body, "quoteId");
      const expiresAt = read.date(body, "quoteExpiresAt");
      remember(providerQuoteId, {
        fields: quoteFields(read, body),
        amount: request.amount,
        expiresAt: expiresAt.getTime(),
      });
      return {
        provider: "fonbnk",
        providerQuoteId,
        // amountBeforeFees on the deposit leg is what we must send; amountAfterFees on the payout leg is what arrives.
        sendUnits: amount(read, deposit, "amountBeforeFees", ASSET_DECIMALS[asset]),
        receiveMinorUnits: amount(read, payout, "amountAfterFees", FIAT_DECIMALS[currency], "down"),
        rate: toDecimalString(toUnits(rate, 10, "down"), 10),
        fees: [
          ...fees(read, deposit, asset, ASSET_DECIMALS[asset]),
          ...fees(read, payout, currency, FIAT_DECIMALS[currency]),
        ],
        expiresAt,
      };
    },

    async createOrder(request) {
      const read = jsonReader("fonbnk", "createOrder");
      const route = routeFor(request.corridor, "createOrder");
      const stored = await storedQuote(request);
      const fieldsToCreateOrder = await recipientFields(request, route, stored.fields);
      const quoted: QuoteAmount = stored.amount ?? { side: "send", units: request.quote.sendUnits };
      const { deposit, payout } = legs(request.corridor, request.source, quoted, "createOrder");
      const asset = request.source.asset;
      const response = await http.request({
        operation: "createOrder",
        method: "POST",
        path: "/api/v2/order",
        body: {
          ...(request.quote.providerQuoteId ? { quoteId: request.quote.providerQuoteId } : {}),
          userEmail: endUserEmail(request),
          userIp: options.endUser.ip,
          userCountryIsoCode: request.corridor.country,
          deposit,
          payout,
          fieldsToCreateOrder,
          orderParams: request.payoutId,
          ...(options.webhookUrl ? { webhookUrl: options.webhookUrl } : {}),
        },
      });
      const body = read.object(response.body, "body");
      const order = read.object(body.order, "order");
      const orderId = read.string(order, "_id");
      const instructions = read.object(
        read.object(order.deposit, "order.deposit").transferInstructions,
        "transferInstructions",
      );
      const details = new Map(
        read.array(instructions.transferDetails, "transferDetails").map((entry) => {
          const detail = read.object(entry, "transferDetail");
          return [detail.id, detail.value] as const;
        }),
      );
      const address = details.get("recipientWalletAddress");
      const toSend = details.get("amountToSend");
      if (typeof address !== "string" || address === "") throw read.fail("recipientWalletAddress is missing");
      if (typeof toSend !== "string") throw read.fail("amountToSend is missing");
      const units = amount(read, { amountToSend: toSend }, "amountToSend", ASSET_DECIMALS[asset]);
      // Without the locked quote, Fonbnk priced the order itself; an unpaid order simply expires, so cancel and refuse it.
      if (body.quoteUsed === false || units !== request.quote.sendUnits) {
        await cancelQuietly(orderId);
        throw new ProviderError("fonbnk", "createOrder", "rejected", "order not priced at the quote");
      }
      return {
        providerOrderId: orderId,
        reference: request.payoutId,
        funding: {
          kind: "deposit_address",
          chain: request.source.chain,
          asset,
          address,
          units,
          validUntil: read.date(order, "expiresAt"),
        },
      };
    },

    // Fonbnk answers 400 to a second confirm or to any order past deposit_awaiting, so a 400 reads the order instead.
    async confirmFunding(providerOrderId, txHash) {
      const response = await http.request({
        operation: "createOrder",
        method: "POST",
        path: "/api/v2/order/confirm",
        body: {
          orderId: providerOrderId,
          fieldsToConfirmOrder: { blockchainTransactionHash: txHash },
        },
        acceptStatuses: [400],
      });
      if (response.status !== 400) {
        return snapshot(jsonReader("fonbnk", "createOrder").object(response.body, "body"));
      }
      const current = await findOrder({ orderId: providerOrderId });
      if (!current)
        throw new ProviderError("fonbnk", "getOrder", "rejected", "confirmed order not found", 400);
      return current;
    },

    getOrder: (lookup) =>
      findOrder(
        "providerOrderId" in lookup ? { orderId: lookup.providerOrderId } : { orderParams: lookup.reference },
      ),

    // Fonbnk has no name lookup: a known institution and a well-formed number is all it can vouch for.
    async verifyAccount(check) {
      const number = check.accountNumber.replace(/\s/g, "");
      if (check.country === "KE" && check.institutionCode === MPESA.code) {
        const valid = /^254[17]\d{8}$/.test(internationalPhone(number, { country: "KE" }));
        return valid ? { found: true, accountName: null } : { found: false };
      }
      const corridor = bankCorridor(check.country);
      const format = ACCOUNT_FORMATS[check.country];
      const banks = corridor ? await cachedBanks(corridor) : [];
      if (!format || !banks.some((bank) => bank.code === check.institutionCode)) {
        throw new ProviderError("fonbnk", "verifyAccount", "not_supported", "institution not offered");
      }
      return format.test(number) ? { found: true, accountName: null } : { found: false };
    },

    async institutions(country) {
      const corridor = bankCorridor(country);
      if (!corridor) return [];
      const banks = await cachedBanks(corridor);
      return country === "KE" ? [MPESA, ...banks] : banks;
    },

    parseWebhook(webhook) {
      const signature = webhook.headers[FONBNK_SIGNATURE_HEADER] ?? "";
      const valid = webhookSecrets.some((secret) =>
        constantTimeEqual(webhookSignature(webhook.rawBody, secret), signature.toLowerCase()),
      );
      if (!valid) {
        options.deps.alert({
          provider: "fonbnk",
          kind: "invalid_signature",
          detail: "webhook signature mismatch",
        });
        throw new ProviderError("fonbnk", "parseWebhook", "invalid_signature", "signature mismatch");
      }
      const read = jsonReader("fonbnk", "parseWebhook");
      let parsed: unknown;
      try {
        parsed = JSON.parse(webhook.rawBody);
      } catch {
        throw read.fail("body is not JSON");
      }
      const body = read.object(parsed, "body");
      const event = read.string(body, "event");
      if (event !== "order-status-change") throw unmappable("parseWebhook", event);
      const order = read.object(read.object(body.data, "data").order, "order");
      const status = read.string(order, "status");
      const mapped = toStatus(status, order);
      if (!mapped) throw unmappable("parseWebhook", status);
      const id = read.string(order, "_id");
      const reference = read.optionalString(order, "merchantOrderParams");
      // Fonbnk sends no event id; one order reaches each status once per update, so id, status and time identify it.
      return {
        eventId: `${id}:${status}:${read.string(order, "updatedAt")}`,
        providerOrderId: id,
        ...(reference ? { reference } : {}),
        order: mapped,
      };
    },

    // No status page or ping is documented; the currency list answering with payout channels is the closest signal.
    async health() {
      const response = await http.request({ operation: "health", method: "GET", path: "/api/v2/currencies" });
      const entries = Array.isArray(response.body) ? (response.body as JsonObject[]) : [];
      const paysOut = entries.some(
        (entry) =>
          entry.currencyType === "fiat" &&
          Array.isArray(entry.paymentChannels) &&
          entry.paymentChannels.some((channel) => (channel as JsonObject).isPayoutAllowed === true),
      );
      return { healthy: paysOut };
    },
  };

  function cachedBanks(corridor: Corridor): Promise<Institution[]> {
    const cached = bankLists.get(corridor.country);
    if (cached && cached.expiresAt > now()) return cached.value;
    const value = banksFrom(corridor);
    bankLists.set(corridor.country, { value, expiresAt: now() + BANK_LIST_TTL_MS });
    value.catch(() => {
      if (bankLists.get(corridor.country)?.value === value) bankLists.delete(corridor.country);
    });
    return value;
  }

  // The bank list comes from a probe quote. Its codes only name banks; orders take codes from their own quote.
  async function banksFrom(corridor: Corridor): Promise<Institution[]> {
    const read = jsonReader("fonbnk", "institutions");
    const source = sources[0];
    if (!source) return [];
    const body = await requestQuote(
      {
        corridor: { ...corridor, payoutType: "bank" },
        source,
        amount: { side: "send", units: INSTITUTIONS_PROBE_UNITS },
      },
      "institutions",
    );
    const bankCode = quoteFields(read, body).find((field) => field.key === "bankCode");
    return (bankCode?.options ?? []).map((option) => ({
      code: option.value,
      name: option.label,
      type: "bank",
    }));
  }

  function webhookSignature(rawBody: string, secret: string): string {
    const secretHash = createHash("sha256").update(secret, "utf8").digest("hex");
    return createHash("sha256").update(rawBody).update(secretHash).digest("hex");
  }

  function transactionMeta(leg: unknown): JsonObject {
    if (typeof leg !== "object" || leg === null) return {};
    const transaction = (leg as JsonObject).transaction;
    if (typeof transaction !== "object" || transaction === null) return {};
    const meta = (transaction as JsonObject).meta;
    return typeof meta === "object" && meta !== null ? (meta as JsonObject) : {};
  }
}

function ceilToWhole(minorUnits: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  return ((minorUnits + scale - 1n) / scale).toString();
}

function sameName(a: string, b: string): boolean {
  const normalise = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalise(a) === normalise(b);
}

// The docs' phone examples are international without "+": 2348012345678, 254712345678.
const DIAL_CODES: Partial<Record<Country, string>> = { NG: "234", KE: "254", GH: "233" };

function internationalPhone(phone: string, place: { country: Country }): string {
  const digits = phone.replace(/\D/g, "");
  const dial = DIAL_CODES[place.country] ?? "";
  if (digits.startsWith(dial)) return digits;
  if (digits.startsWith("0")) return dial + digits.slice(1);
  return dial + digits;
}
