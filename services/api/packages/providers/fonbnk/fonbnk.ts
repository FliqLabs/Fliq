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
  CreateOrderRequest,
  Fee,
  FiatCurrency,
  Institution,
  OrderStatus,
  OrderSnapshot,
  ProviderAdapter,
  ProviderQuote,
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

// Create order requires an end user. Whose identity this is (each sender, or one for fliq) is a team decision.
export type FonbnkEndUser = { email: string; ip: string };

export type FonbnkOptions = {
  clientId: string;
  signatureSecret: string;
  webhookSecrets: readonly string[];
  environment: FonbnkEnvironment;
  endUser: FonbnkEndUser;
  webhookUrl?: string;
  deps: AdapterDeps;
  baseUrl?: string;
  maxConcurrent?: number;
};

// Fonbnk only starts checking a crypto deposit once it is told the transaction hash (POST /api/v2/order/confirm).
export type FonbnkAdapter = ProviderAdapter & {
  confirmDeposit(providerOrderId: string, transactionHash: string): Promise<OrderSnapshot>;
};

type Route = { paymentChannel: "bank" | "mobile_money"; carrierCode?: string };

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

// A quote is only used to read the bank list, so its amount just has to clear every corridor's minimum.
const INSTITUTIONS_PROBE_UNITS = 10_000_000n;

export function createFonbnkAdapter(options: FonbnkOptions): FonbnkAdapter {
  const webhookSecrets = options.webhookSecrets.map((secret) => secret.trim()).filter(Boolean);
  const signingKey = Buffer.from(options.signatureSecret, "base64");
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
  };

  function routeFor(corridor: Corridor, operation: "quote" | "createOrder" | "institutions"): Route {
    const route = ROUTES[`${corridor.country}:${corridor.payoutType}`];
    if (!route) throw new ProviderError("fonbnk", operation, "not_supported", `corridor ${corridor.country}`);
    return route;
  }

  function currencyCode(source: SourceAsset, operation: "quote" | "createOrder" | "institutions"): string {
    const entry = NETWORKS[source.chain];
    if (!entry?.assets.includes(source.asset)) {
      throw new ProviderError("fonbnk", operation, "not_supported", `${source.asset} on ${source.chain}`);
    }
    return `${entry.network}_${source.asset}`;
  }

  function legs(
    corridor: Corridor,
    source: SourceAsset,
    operation: "quote" | "createOrder" | "institutions",
  ) {
    const route = routeFor(corridor, operation);
    return {
      deposit: {
        paymentChannel: "crypto",
        currencyType: "crypto",
        currencyCode: currencyCode(source, operation),
      },
      payout: {
        paymentChannel: route.paymentChannel,
        currencyType: "fiat",
        currencyCode: corridor.currency,
        countryIsoCode: corridor.country,
        ...(route.carrierCode ? { carrierCode: route.carrierCode } : {}),
      },
    };
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

  async function requestQuote(request: Omit<QuoteRequest, "quoteId">, operation: "quote" | "institutions") {
    const { deposit, payout } = legs(request.corridor, request.source, operation);
    const fiatDecimals = FIAT_DECIMALS[request.corridor.currency];
    const body =
      request.amount.side === "send"
        ? {
            deposit: {
              ...deposit,
              amount: Number(toDecimalString(request.amount.units, ASSET_DECIMALS[request.source.asset])),
            },
            payout,
          }
        : {
            deposit,
            // Fiat amounts are whole units on these corridors, so round up to never pay less than asked.
            payout: { ...payout, amount: Number(ceilToWhole(request.amount.minorUnits, fiatDecimals)) },
          };
    const response = await http.request({
      operation,
      method: "POST",
      path: "/api/v2/quote",
      body,
      acceptStatuses: [404],
    });
    if (response.status === 404) throw quoteRefused(response.body, operation);
    return jsonReader("fonbnk", operation).object(response.body, "body");
  }

  function quoteRefused(body: unknown, operation: "quote" | "institutions"): ProviderError {
    const code = typeof body === "object" && body !== null ? (body as JsonObject).errorCode : undefined;
    const errorCode = typeof code === "string" ? code : "unknown";
    // errors.md: ROUTE_NOT_AVAILABLE is the only 404 worth retrying.
    const kind = errorCode === "ROUTE_NOT_AVAILABLE" ? "unavailable" : "rejected";
    return new ProviderError("fonbnk", operation, kind, `quote refused: ${errorCode}`, 404);
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
        return { status: "failed", code: status, retryable: true };
      case "deposit_invalid":
        return { status: "failed", code: "deposit_invalid", retryable: false };
      default:
        return null;
    }
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

  function recipientFields(request: CreateOrderRequest, route: Route): Record<string, string> {
    const { recipient, corridor } = request;
    const phone =
      recipient.phone ?? (route.paymentChannel === "mobile_money" ? recipient.accountNumber : undefined);
    if (route.paymentChannel === "mobile_money")
      return { phoneNumber: internationalPhone(phone ?? "", corridor) };
    // Nigerian bank payouts require the recipient's phone (bank-transfer.md); Kenyan bank payouts take it when present.
    if (corridor.country === "NG" && !phone) {
      throw new ProviderError(
        "fonbnk",
        "createOrder",
        "rejected",
        "recipient phone is required for NG bank payouts",
      );
    }
    return {
      bankCode: recipient.institutionCode,
      bankAccountNumber: recipient.accountNumber,
      ...(phone ? { phoneNumber: internationalPhone(phone, corridor) } : {}),
    };
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
      return {
        provider: "fonbnk",
        providerQuoteId: read.string(body, "quoteId"),
        // amountBeforeFees on the deposit leg is what we must send; amountAfterFees on the payout leg is what arrives.
        sendUnits: amount(read, deposit, "amountBeforeFees", ASSET_DECIMALS[asset]),
        receiveMinorUnits: amount(read, payout, "amountAfterFees", FIAT_DECIMALS[currency], "down"),
        rate: toDecimalString(toUnits(rate, 10, "down"), 10),
        fees: [
          ...fees(read, deposit, asset, ASSET_DECIMALS[asset]),
          ...fees(read, payout, currency, FIAT_DECIMALS[currency]),
        ],
        expiresAt: read.date(body, "quoteExpiresAt"),
      };
    },

    async createOrder(request) {
      const read = jsonReader("fonbnk", "createOrder");
      const route = routeFor(request.corridor, "createOrder");
      const { deposit, payout } = legs(request.corridor, request.source, "createOrder");
      const asset = request.source.asset;
      const response = await http.request({
        operation: "createOrder",
        method: "POST",
        path: "/api/v2/order",
        body: {
          ...(request.quote.providerQuoteId ? { quoteId: request.quote.providerQuoteId } : {}),
          userEmail: options.endUser.email,
          userIp: options.endUser.ip,
          userCountryIsoCode: request.corridor.country,
          deposit: {
            ...deposit,
            amount: Number(toDecimalString(request.quote.sendUnits, ASSET_DECIMALS[asset])),
          },
          payout,
          fieldsToCreateOrder: recipientFields(request, route),
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

    async confirmDeposit(providerOrderId, transactionHash) {
      const response = await http.request({
        operation: "createOrder",
        method: "POST",
        path: "/api/v2/order/confirm",
        body: {
          orderId: providerOrderId,
          fieldsToConfirmOrder: { blockchainTransactionHash: transactionHash },
        },
      });
      return snapshot(jsonReader("fonbnk", "createOrder").object(response.body, "body"));
    },

    getOrder: (lookup) =>
      findOrder(
        "providerOrderId" in lookup ? { orderId: lookup.providerOrderId } : { orderParams: lookup.reference },
      ),

    async verifyAccount() {
      throw new ProviderError(
        "fonbnk",
        "verifyAccount",
        "not_supported",
        "no account lookup in the Fonbnk API",
      );
    },

    async institutions(country) {
      if (country === "KE") {
        const mpesa: Institution = { code: "ke_safaricom", name: "M-PESA", type: "mobile_money" };
        return [mpesa, ...(await banksFrom({ country: "KE", currency: "KES", payoutType: "bank" }))];
      }
      if (country === "NG") return banksFrom({ country: "NG", currency: "NGN", payoutType: "bank" });
      return [];
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

  // Bank codes are specific to the quote that lists them (bank-transfer.md), so they are read from a quote.
  async function banksFrom(corridor: Corridor): Promise<Institution[]> {
    const read = jsonReader("fonbnk", "institutions");
    const source = sources[0];
    if (!source) return [];
    const body = await requestQuote(
      { corridor, source, amount: { side: "send", units: INSTITUTIONS_PROBE_UNITS } },
      "institutions",
    );
    const fields = read.array(
      read.object(body.payout, "payout").fieldsToCreateOrder ?? [],
      "fieldsToCreateOrder",
    );
    const bankCode = fields
      .map((field) => read.object(field, "field"))
      .find((field) => field.key === "bankCode");
    if (!bankCode) return [];
    return read.array(bankCode.options ?? [], "options").map((entry) => {
      const option = read.object(entry, "option");
      return { code: read.string(option, "value"), name: read.string(option, "label"), type: "bank" };
    });
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

// The docs' phone examples are international without "+": 2348012345678, 254712345678.
const DIAL_CODES: Partial<Record<Corridor["country"], string>> = { NG: "234", KE: "254", GH: "233" };

function internationalPhone(phone: string, corridor: Corridor): string {
  const digits = phone.replace(/\D/g, "");
  const dial = DIAL_CODES[corridor.country] ?? "";
  if (digits.startsWith(dial)) return digits;
  if (digits.startsWith("0")) return dial + digits.slice(1);
  return dial + digits;
}
