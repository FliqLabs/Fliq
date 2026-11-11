import { verifyHmac } from "../../webhooks/hmac";
import { ProviderError, type ProviderOperation } from "../errors";
import { createProviderHttp } from "../http";
import { jsonReader, type JsonObject } from "../json";
import { ASSET_DECIMALS, FIAT_DECIMALS, InvalidAmountError, toDecimalString, toUnits } from "../money";
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
  Limits,
  OrderSnapshot,
  OrderStatus,
  PayoutType,
  ProviderAdapter,
  ProviderQuote,
  Recipient,
  SourceAsset,
} from "../types";

// Sources: services/Project MD/EXTERNAL_ADAPTERS/TRANSFI.md, verified against docs.transfi.com (API v3) on 2026-11-07.
export const TRANSFI_BASE_URL = {
  production: "https://api.transfi.com",
  sandbox: "https://sandbox-api.transfi.com",
};
export const TRANSFI_SIGNATURE_HEADER = "x-transfi-hmac-hash";

export type TransfiEnvironment = keyof typeof TRANSFI_BASE_URL;

// Every off-ramp order needs a KYC-approved TransFi sender (UX-…) and device details. Whose identity that is
// (one fliq sender, or each of our senders) is a team decision, so both come from configuration.
export type TransfiSender = { userId: string; ip: string };

export type TransfiOptions = {
  username: string;
  password: string;
  mid: string;
  environment: TransfiEnvironment;
  webhookSecrets: readonly string[];
  sender: TransfiSender;
  deps: AdapterDeps;
  baseUrl?: string;
  maxConcurrent?: number;
};

// capabilities() stays synchronous for routing; this loads the payment methods it is built from.
export type TransfiAdapter = ProviderAdapter & { refreshCapabilities(): Promise<Capabilities> };

const CURRENCY_OF: Partial<Record<Country, FiatCurrency>> = { ID: "IDR", PH: "PHP" };
const CURRENCIES = Object.values(CURRENCY_OF).filter((currency) => currency !== undefined);

// Supported Crypto Currencies page: deposit-enabled tickers, which carry the network as a suffix.
// Order is preference: the hop picks the first source, so chains we watch and hold refund addresses for come first.
const TICKER_SUFFIX: Partial<Record<Chain, { suffix: string; assets: readonly Asset[] }>> = {
  base: { suffix: "BASE", assets: ["USDC"] },
  polygon: { suffix: "POLYGON", assets: ["USDC", "USDT"] },
  solana: { suffix: "SOL", assets: ["USDC", "USDT"] },
  arbitrum: { suffix: "ARB", assets: ["USDC", "USDT"] },
  bnb: { suffix: "BSC", assets: ["USDC", "USDT"] },
  tron: { suffix: "TRC20", assets: ["USDT"] },
  celo: { suffix: "CELO", assets: ["USDC", "USDT"] },
};

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ADDRESS_FORMAT: Partial<Record<Chain, RegExp>> = {
  base: EVM_ADDRESS,
  polygon: EVM_ADDRESS,
  arbitrum: EVM_ADDRESS,
  bnb: EVM_ADDRESS,
  celo: EVM_ADDRESS,
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  tron: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
};

const PHONE_FORMAT: Partial<Record<Country, { code: string; national: RegExp }>> = {
  PH: { code: "63", national: /^9\d{9}$/ },
  ID: { code: "62", national: /^8\d{8,11}$/ },
};

// Rupiah transfers carry no fractions, so until TransFi's own precision loads we never send one it may refuse.
const DEFAULT_PRECISION: Partial<Record<FiatCurrency, number>> = { IDR: 0 };

const PAYOUT_TYPE: Record<string, PayoutType> = { bank_transfer: "bank", local_wallet: "mobile_money" };
const PAYMENT_TYPE: Record<PayoutType, string> = { bank: "bank_transfer", mobile_money: "local_wallet" };

const ACCOUNT_FIELDS = ["accountNumber", "bankAccountNumber", "account_number", "accountNo"];
const NAME_FIELDS = ["accountName", "accountHolderName", "beneficiaryName"];
const PHONE_FIELDS = ["phone", "phoneNumber", "mobileNumber"];
const BANK_ACCOUNT_NUMBER = /^\d{6,20}$/;

// The rates endpoint returns no quote id and no expiry ("valid from when you request it"), so we hold a quote briefly.
const QUOTE_TTL_MS = 60_000;
const CAPABILITIES_TTL_MS = 24 * 60 * 60 * 1000;
const CAPABILITIES_RETRY_MS = 5 * 60 * 1000;
// The same margin the API keeps between a shown quote and the firm price, so a small live-rate move still pays out.
const PRICE_TOLERANCE_BPS = 30n;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const PURPOSE_CODE = "remittance";
const USER_AGENT = "fliq-api";
// Only this failure refunds the crypto to the sender's wallet; TransFi keeps any other refund in our balance.
const REFUNDED_TO_SENDER = "INVALID_ACCOUNT_DETAILS";

type Method = {
  code: string;
  name: string;
  payoutType: PayoutType;
  min: bigint;
  max: bigint;
  fields: string[];
};

type Loaded = {
  capabilities: Capabilities;
  methods: Map<FiatCurrency, Method[]>;
  precision: Map<FiatCurrency, number>;
};

export function createTransfiAdapter(options: TransfiOptions): TransfiAdapter {
  const now = () => (options.deps.now ?? (() => new Date()))().getTime();
  const sandbox = options.environment === "sandbox";
  const webhookSecrets = options.webhookSecrets.map((secret) => secret.trim()).filter(Boolean);
  const basic = Buffer.from(`${options.username}:${options.password}`).toString("base64");
  const http = createProviderHttp({
    provider: "transfi",
    baseUrl: options.baseUrl ?? TRANSFI_BASE_URL[options.environment],
    maxConcurrent: options.maxConcurrent ?? 4,
    ...(options.deps.fetch ? { fetch: options.deps.fetch } : {}),
    authHeaders: () => ({ Authorization: `Basic ${basic}`, mid: options.mid }),
  });

  const sources: SourceAsset[] = Object.entries(TICKER_SUFFIX).flatMap(([chain, entry]) =>
    (entry?.assets ?? []).map((asset) => ({ asset, chain: chain as Chain })),
  );

  let loaded: Loaded = {
    capabilities: {
      provider: "transfi",
      custody: "one_time_address",
      corridors: [],
      sources,
      limits: {},
      sandbox,
    },
    methods: new Map(),
    precision: new Map(),
  };
  let loadedAt: number | undefined;
  let attemptedAt: number | undefined;
  let inflight: Promise<Capabilities> | null = null;
  const custodialAlerts = new Set<string>();

  function refreshDue(): boolean {
    if (inflight) return false;
    const time = now();
    if (loadedAt !== undefined && time - loadedAt < CAPABILITIES_TTL_MS) return false;
    return attemptedAt === undefined || time - attemptedAt >= CAPABILITIES_RETRY_MS;
  }

  function refreshCapabilities(): Promise<Capabilities> {
    if (inflight) return inflight;
    attemptedAt = now();
    inflight = loadCatalogue()
      .then(({ methods, precision, complete }) => {
        loaded = { capabilities: buildCapabilities(methods), methods, precision };
        if (complete) loadedAt = now();
        return loaded.capabilities;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  function refreshIfDue(): Promise<unknown> {
    const pending = inflight ?? (refreshDue() ? refreshCapabilities() : Promise.resolve());
    return pending.catch(() => undefined);
  }

  // A currency that fails to load keeps its last good methods and is retried sooner; the others still serve.
  async function loadCatalogue() {
    const methods = new Map<FiatCurrency, Method[]>();
    let failure: unknown;
    for (const currency of CURRENCIES) {
      try {
        methods.set(currency, await methodsFor(currency));
      } catch (error) {
        failure ??= error;
        const previous = loaded.methods.get(currency);
        if (previous) methods.set(currency, previous);
      }
    }
    if (methods.size === 0) throw failure;
    const precision = await loadPrecision().catch(() => loaded.precision);
    return { methods, precision, complete: failure === undefined };
  }

  async function methodsFor(currency: FiatCurrency): Promise<Method[]> {
    const read = jsonReader("transfi", "institutions");
    const methods: Method[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const response = await http.request({
        operation: "institutions",
        method: "GET",
        path: "/v3/config/payment-methods",
        query: {
          direction: "withdraw",
          currency,
          headlessMode: "true",
          userType: "individual",
          limit: String(PAGE_SIZE),
          page: String(page),
        },
        acceptStatuses: [404],
      });
      if (response.status === 404) {
        const code = errorCode(response.body);
        if (code === "NO_PAYMENT_METHODS_AVAILABLE") return methods;
        throw new ProviderError(
          "transfi",
          "institutions",
          "rejected",
          "payment methods not found",
          404,
          code,
        );
      }
      const body = read.object(response.body, "body");
      for (const entry of read.array(body.data, "data")) {
        const method = toMethod(read, read.object(entry, "paymentMethod"), currency);
        if (method) methods.push(method);
      }
      if (!hasNext(body)) return methods;
    }
    return methods;
  }

  async function loadPrecision(): Promise<Map<FiatCurrency, number>> {
    const read = jsonReader("transfi", "institutions");
    const precision = new Map(loaded.precision);
    for (let page = 1; page <= MAX_PAGES; page++) {
      const response = await http.request({
        operation: "institutions",
        method: "GET",
        path: "/v3/config/supported-currencies",
        query: { direction: "withdraw", limit: String(PAGE_SIZE), page: String(page) },
      });
      const body = read.object(response.body, "body");
      for (const entry of read.array(body.data, "data")) {
        const record = read.object(entry, "currency");
        const currency = CURRENCIES.find((candidate) => candidate === record.currency);
        const places = record.decimalPrecision;
        if (currency && typeof places === "number" && Number.isInteger(places) && places >= 0)
          precision.set(currency, Math.min(places, FIAT_DECIMALS[currency]));
      }
      if (!hasNext(body)) break;
    }
    return precision;
  }

  function toMethod(read: Reader, entry: JsonObject, currency: FiatCurrency): Method | null {
    const payoutType = PAYOUT_TYPE[read.string(entry, "paymentType")];
    if (!payoutType) return null;
    const decimals = FIAT_DECIMALS[currency];
    const details = entry.additionalDetails;
    return {
      code: read.string(entry, "paymentCode"),
      name: read.string(entry, "name"),
      payoutType,
      min: amount(read, entry, "minAmount", decimals, "up"),
      max: amount(read, entry, "maxAmount", decimals, "down"),
      fields: typeof details === "object" && details !== null ? Object.keys(details) : [],
    };
  }

  function buildCapabilities(methods: Map<FiatCurrency, Method[]>): Capabilities {
    const corridors: Corridor[] = [];
    const limits: Partial<Record<FiatCurrency, Limits>> = {};
    for (const [country, currency] of Object.entries(CURRENCY_OF) as [Country, FiatCurrency][]) {
      const list = methods.get(currency) ?? [];
      for (const payoutType of ["bank", "mobile_money"] as const) {
        if (list.some((method) => method.payoutType === payoutType))
          corridors.push({ country, currency, payoutType });
      }
      const first = list[0];
      if (!first) continue;
      // Limits are per currency here, so take the widest range; TransFi still enforces each method's own.
      limits[currency] = list.reduce<Limits>(
        (range, method) => ({
          side: "receive",
          min: method.min < range.min ? method.min : range.min,
          max: method.max > range.max ? method.max : range.max,
        }),
        { side: "receive", min: first.min, max: first.max },
      );
    }
    return { provider: "transfi", custody: "one_time_address", corridors, sources, limits, sandbox };
  }

  async function methodsIn(currency: FiatCurrency, operation: ProviderOperation): Promise<Method[]> {
    const refresh = refreshIfDue();
    if (!loaded.methods.has(currency)) await refresh;
    const methods = loaded.methods.get(currency);
    if (!methods)
      throw new ProviderError(
        "transfi",
        operation,
        "unavailable",
        `payment methods for ${currency} not loaded`,
      );
    return methods;
  }

  async function paymentMethod(currency: FiatCurrency, code: string): Promise<Method> {
    const method = (await methodsIn(currency, "createOrder")).find((entry) => entry.code === code);
    if (!method) throw new ProviderError("transfi", "createOrder", "rejected", "unknown payment code");
    return method;
  }

  function currencyFor(corridor: Corridor, operation: ProviderOperation): FiatCurrency {
    const currency = CURRENCY_OF[corridor.country];
    if (currency !== corridor.currency)
      throw new ProviderError("transfi", operation, "not_supported", `corridor ${corridor.country}`);
    return currency;
  }

  function ticker(source: SourceAsset, operation: ProviderOperation): string {
    const entry = TICKER_SUFFIX[source.chain];
    if (!entry?.assets.includes(source.asset))
      throw new ProviderError("transfi", operation, "not_supported", `${source.asset} on ${source.chain}`);
    return `${source.asset}${entry.suffix}`;
  }

  function payable(minorUnits: bigint, currency: FiatCurrency): bigint {
    const places = loaded.precision.get(currency) ?? DEFAULT_PRECISION[currency] ?? FIAT_DECIMALS[currency];
    const step = 10n ** BigInt(FIAT_DECIMALS[currency] - places);
    return minorUnits - (minorUnits % step);
  }

  function toStatus(status: string, order: JsonObject): OrderStatus | null {
    switch (status) {
      case "initiated":
        return { status: "awaiting_deposit" };
      case "asset_deposited":
        return { status: "deposit_received" };
      case "asset_processing":
      case "fund_processing":
      // A compliance hold, not an outcome.
      case "manual_review":
        return { status: "processing" };
      case "fund_settled": {
        const fiatReference = firstString(order.bankTxnId);
        return fiatReference ? { status: "paid", fiatReference } : { status: "paid" };
      }
      // Off-ramp fails the fiat leg only after the crypto arrived, and TransFi refunds crypto automatically.
      case "fund_failed":
        return { status: "refunding" };
      // Off-ramp orders expire or are cancelled before any crypto arrives.
      case "expired":
      case "cancelled":
        return { status: "failed", code: "deposit_expired", retryable: true };
      // asset_settle_failed is left out on purpose: the docs do not say whether the crypto had arrived.
      default:
        return null;
    }
  }

  function unmappable(operation: "getOrder" | "parseWebhook", value: string): ProviderError {
    options.deps.alert({ provider: "transfi", kind: "unmappable_status", detail: `${operation} ${value}` });
    return new ProviderError("transfi", operation, "unmappable_status", value);
  }

  // The poller re-reads a refunding order every few seconds, so each order alerts once per process.
  function alertIfCustodial(orderId: string, mapped: OrderStatus, order: JsonObject): void {
    if (mapped.status !== "refunding") return;
    const code = safeCode(order.failureCode);
    if (code === REFUNDED_TO_SENDER || custodialAlerts.has(orderId)) return;
    custodialAlerts.add(orderId);
    options.deps.alert({ provider: "transfi", kind: "custodial_refund", detail: `${orderId} ${code}` });
  }

  function snapshot(order: JsonObject, reference?: string): OrderSnapshot {
    const read = jsonReader("transfi", "getOrder");
    const status = read.string(order, "status");
    const mapped = toStatus(status, order);
    if (!mapped) throw unmappable("getOrder", status);
    const providerOrderId = read.string(order, "id");
    alertIfCustodial(providerOrderId, mapped, order);
    return { providerOrderId, ...(reference ? { reference } : {}), ...mapped };
  }

  function nationalPhone(country: Country, input: string): string | null {
    const format = PHONE_FORMAT[country];
    const digits = input.replace(/[\s()+-]/g, "");
    if (!format || !/^\d+$/.test(digits)) return null;
    const national = digits.startsWith(format.code)
      ? digits.slice(format.code.length)
      : digits.startsWith("0")
        ? digits.slice(1)
        : digits;
    return format.national.test(national) ? national : null;
  }

  function fieldValue(field: string, recipient: Recipient, phone: string | null, country: Country) {
    if (ACCOUNT_FIELDS.includes(field)) return recipient.accountNumber;
    if (NAME_FIELDS.includes(field)) return recipient.accountName;
    if (field === "firstName") return splitName(recipient.accountName).firstName;
    if (field === "lastName") return splitName(recipient.accountName).lastName;
    if (PHONE_FIELDS.includes(field)) return phone ?? undefined;
    const format = PHONE_FORMAT[country];
    if (field === "phoneCode" && format) return `+${format.code}`;
    return undefined;
  }

  // Every listed field is required: a missing or guessed one lets TransFi fail the order after the crypto arrives.
  function paymentDetails(method: Method, recipient: Recipient, country: Country): Record<string, string> {
    const wallet = method.payoutType === "mobile_money";
    const phone = nationalPhone(
      country,
      wallet ? (recipient.phone ?? recipient.accountNumber) : (recipient.phone ?? ""),
    );
    if (wallet && !phone)
      throw new ProviderError("transfi", "createOrder", "rejected", `phone number not valid for ${country}`);
    const fields =
      wallet && !method.fields.some((field) => PHONE_FIELDS.includes(field))
        ? [...method.fields, "phone"]
        : method.fields;
    const details: Record<string, string> = {};
    for (const field of fields) {
      const value = fieldValue(field, recipient, phone, country);
      if (!value)
        throw new ProviderError(
          "transfi",
          "createOrder",
          "not_supported",
          `cannot fill ${field} for ${method.code}`,
        );
      details[field] = value;
    }
    if (!wallet && !ACCOUNT_FIELDS.some((field) => field in details)) {
      throw new ProviderError(
        "transfi",
        "createOrder",
        "not_supported",
        `no account field for ${method.code}`,
      );
    }
    return details;
  }

  async function cancelQuietly(orderId: string): Promise<void> {
    await http
      .request({
        operation: "createOrder",
        method: "POST",
        path: "/v3/orders/cancel",
        body: { orderId, reason: "order does not match the quote" },
      })
      .catch(() => undefined);
  }

  function rejectOrder(detail: string): ProviderError {
    return new ProviderError("transfi", "createOrder", "rejected", detail);
  }

  function fundingFrom(data: JsonObject, request: CreateOrderRequest, sourceCurrency: string) {
    const read = jsonReader("transfi", "createOrder");
    const { asset, chain } = request.source;
    const units = amount(read, data, "cryptoAmount", ASSET_DECIMALS[asset], "up");
    if (units * 10_000n > request.quote.sendUnits * (10_000n + PRICE_TOLERANCE_BPS))
      throw rejectOrder("order not priced at the quote");
    const currency = read.optionalString(data, "cryptoCurrency");
    if (currency && currency.toUpperCase() !== sourceCurrency) throw rejectOrder("deposit asset differs");
    const network = read.optionalString(data, "cryptoNetwork")?.toLowerCase();
    if (network && network !== chain && network !== TICKER_SUFFIX[chain]?.suffix.toLowerCase())
      throw rejectOrder("deposit network differs");
    const address = read.optionalString(data, "walletAddress") ?? "";
    if (!ADDRESS_FORMAT[chain]?.test(address)) throw rejectOrder(`deposit address not valid on ${chain}`);
    return { kind: "deposit_address" as const, chain, asset, address, units };
  }

  refreshCapabilities().catch(() => undefined);

  return {
    id: "transfi",

    capabilities() {
      void refreshIfDue();
      return loaded.capabilities;
    },

    refreshCapabilities,

    async quote(request): Promise<ProviderQuote> {
      const read = jsonReader("transfi", "quote");
      const currency = currencyFor(request.corridor, "quote");
      const fiatDecimals = FIAT_DECIMALS[currency];
      const assetDecimals = ASSET_DECIMALS[request.source.asset];
      const forward = request.amount.side === "send";
      const response = await http.request({
        operation: "quote",
        method: "GET",
        path: "/v3/exchange-rates",
        query: {
          amount:
            request.amount.side === "send"
              ? toDecimalString(request.amount.units, assetDecimals)
              : toDecimalString(request.amount.minorUnits, fiatDecimals),
          sourceCurrency: ticker(request.source, "quote"),
          destinationCurrency: currency,
          orderType: "offramp",
          direction: forward ? "forward" : "reverse",
        },
      });
      const data = envelope(read, response.body);
      if (read.string(data, "destinationCurrency") !== currency)
        throw read.fail("destinationCurrency differs");
      const sendUnits = amount(read, data, "sourceAmount", assetDecimals, "up");
      const receiveMinorUnits = payable(
        amount(read, data, "destinationAmount", fiatDecimals, "down"),
        currency,
      );
      // The meaning of direction=reverse is undocumented, so a quote is only used if it priced the side we fixed.
      const honoured =
        request.amount.side === "send"
          ? sendUnits === request.amount.units
          : receiveMinorUnits >= request.amount.minorUnits;
      if (!honoured) throw read.fail("quote does not match the requested amount");
      return {
        provider: "transfi",
        sendUnits,
        receiveMinorUnits,
        rate: fiatPerAsset(read, data),
        fees: quoteFees(read, data, currency),
        expiresAt: new Date(now() + QUOTE_TTL_MS),
      };
    },

    async createOrder(request) {
      const read = jsonReader("transfi", "createOrder");
      const currency = currencyFor(request.corridor, "createOrder");
      const sourceCurrency = ticker(request.source, "createOrder");
      const method = await paymentMethod(currency, request.recipient.institutionCode);
      const additionalPaymentDetails = paymentDetails(method, request.recipient, request.corridor.country);
      const receive = payable(request.quote.receiveMinorUnits, currency);
      const response = await http.request({
        operation: "createOrder",
        method: "POST",
        path: "/v3/orders",
        acceptStatuses: [400],
        body: {
          userId: options.sender.userId,
          orderType: "offramp",
          purposeCode: PURPOSE_CODE,
          partnerId: request.payoutId,
          headlessMode: true,
          deviceDetails: { userAgent: USER_AGENT, ipInfo: { ip: options.sender.ip } },
          source: { currency: sourceCurrency, sendersWalletAddress: request.refundAddress },
          // Fixing the fiat side guarantees the quoted receive amount; the crypto it asks for is checked below.
          destination: {
            currency,
            amount: Number(toDecimalString(receive, FIAT_DECIMALS[currency])),
            paymentType: PAYMENT_TYPE[method.payoutType],
            paymentCode: method.code,
            additionalPaymentDetails,
          },
        },
      });
      if (response.status === 400) {
        const code = errorCode(response.body);
        throw new ProviderError("transfi", "createOrder", "rejected", code, 400, code);
      }
      const data = read.object(read.object(response.body, "body").data, "data");
      const orderId = read.string(data, "orderId");
      try {
        return {
          providerOrderId: orderId,
          reference: request.payoutId,
          funding: fundingFrom(data, request, sourceCurrency),
        };
      } catch (error) {
        await cancelQuietly(orderId);
        throw error;
      }
    },

    // The path takes TransFi's order id or our partnerId (Migration guide, "Reading an order").
    async getOrder(lookup) {
      const id = "providerOrderId" in lookup ? lookup.providerOrderId : lookup.reference;
      const response = await http.request({
        operation: "getOrder",
        method: "GET",
        path: `/v3/orders/${encodeURIComponent(id)}`,
        acceptStatuses: [400],
      });
      // Only the documented not-found answer means "no order": treating any other error as absence would
      // let reconciliation create a second order for the same payout.
      if (response.status === 400) {
        const code = errorCode(response.body);
        if (code === "TRANSFER_NOT_FOUND") return null;
        throw new ProviderError("transfi", "getOrder", "rejected", code, 400, code);
      }
      const read = jsonReader("transfi", "getOrder");
      const data = read.object(read.object(response.body, "body").data, "data");
      return snapshot(data, "reference" in lookup ? lookup.reference : undefined);
    },

    // TransFi has no account lookup, so a known payment method and a well-formed number is all we can confirm.
    async verifyAccount(check) {
      const currency = CURRENCY_OF[check.country];
      if (!currency) return { found: false };
      const methods = await methodsIn(currency, "verifyAccount");
      const method = methods.find((entry) => entry.code === check.institutionCode);
      if (!method) return { found: false };
      const valid =
        method.payoutType === "mobile_money"
          ? nationalPhone(check.country, check.accountNumber) !== null
          : BANK_ACCOUNT_NUMBER.test(check.accountNumber);
      return valid ? { found: true, accountName: null } : { found: false };
    },

    async institutions(country) {
      const currency = CURRENCY_OF[country];
      if (!currency) return [];
      return (await methodsIn(currency, "institutions")).map(
        (method): Institution => ({ code: method.code, name: method.name, type: method.payoutType }),
      );
    },

    parseWebhook(webhook) {
      const valid = verifyHmac({
        algorithm: "sha256",
        encoding: "hex",
        secrets: webhookSecrets,
        payload: webhook.rawBody,
        signature: webhook.headers[TRANSFI_SIGNATURE_HEADER],
      });
      if (!valid) {
        options.deps.alert({
          provider: "transfi",
          kind: "invalid_signature",
          detail: "webhook signature mismatch",
        });
        throw new ProviderError("transfi", "parseWebhook", "invalid_signature", "signature mismatch");
      }
      const read = jsonReader("transfi", "parseWebhook");
      let parsed: unknown;
      try {
        parsed = JSON.parse(webhook.rawBody);
      } catch {
        throw read.fail("body is not JSON");
      }
      const body = read.object(parsed, "body");
      const entityType = read.string(body, "entityType");
      const entityId = read.string(body, "entityId");
      const status = read.string(body, "status");
      // The docs' samples reuse one eventId across statuses and say to key on entityId + status.
      const eventId = `${entityId}:${status}`;
      // Sender KYC updates share this endpoint; awaiting_deposit names no payout and moves nothing.
      if (entityType === "user") return { eventId, order: { status: "awaiting_deposit" } };
      if (entityType !== "order") throw unmappable("parseWebhook", `entityType ${entityType}`);
      const order = read.object(body.order, "order");
      // Webhooks call an off-ramp order "sell" where the REST API says "offramp".
      const type = read.string(order, "type");
      if (type !== "sell") throw unmappable("parseWebhook", `order type ${type}`);
      const mapped = toStatus(status, order);
      if (!mapped) throw unmappable("parseWebhook", status);
      const providerOrderId = read.string(order, "orderId");
      alertIfCustodial(providerOrderId, mapped, order);
      return { eventId, providerOrderId, order: mapped };
    },

    async health() {
      const response = await http.request({
        operation: "health",
        method: "GET",
        path: "/v3/config/list-mids",
      });
      const body = response.body as { status?: unknown } | null;
      return { healthy: body?.status === "success" };
    },
  };
}

type Reader = ReturnType<typeof jsonReader>;

// The rates example omits the success envelope that its own schema declares, so both shapes are read.
function envelope(read: Reader, body: unknown): JsonObject {
  const root = read.object(body, "body");
  return root.status === "success" ? read.object(root.data, "data") : root;
}

function hasNext(body: JsonObject): boolean {
  const pagination = body.pagination;
  return typeof pagination === "object" && pagination !== null && (pagination as JsonObject).hasNext === true;
}

// customerFee is the partner fee set on our account; the samples show it inside totalFee (UNVERIFIED).
function quoteFees(read: Reader, data: JsonObject, currency: FiatCurrency): Fee[] {
  const decimals = FIAT_DECIMALS[currency];
  const total = amount(read, data, "totalFee", decimals, "down");
  const partner = data.customerFee === undefined ? 0n : amount(read, data, "customerFee", decimals, "down");
  if (partner === 0n) return [{ kind: "provider", amount: total, unit: currency }];
  return [
    { kind: "provider", amount: total - partner, unit: currency },
    { kind: "provider", amount: partner, unit: currency },
  ];
}

// A one-word name, common in Indonesia, has no last name to split off, so it fills both parts.
function splitName(name: string): { firstName: string; lastName: string } {
  const trimmed = name.trim();
  const space = trimmed.lastIndexOf(" ");
  if (space < 0) return { firstName: trimmed, lastName: trimmed };
  return { firstName: trimmed.slice(0, space).trim(), lastName: trimmed.slice(space + 1) };
}

// TransFi sends money as JSON numbers or strings in major units. "up" is for amounts we must pay in full.
function amount(
  read: Reader,
  record: JsonObject,
  key: string,
  decimals: number,
  rounding: "up" | "down",
): bigint {
  const value = record[key];
  if (typeof value !== "number" && typeof value !== "string") throw read.fail(`${key} is missing`);
  try {
    const down = toUnits(value, decimals, "down");
    if (rounding === "down") return down;
    const precise = toUnits(value, decimals + 18, "down");
    return precise > down * 10n ** 18n ? down + 1n : down;
  } catch (error) {
    if (error instanceof InvalidAmountError) throw read.fail(`${key} is not a valid amount`);
    throw error;
  }
}

// conversionRate is source per gross destination (USDC per peso); routing wants fiat per one asset unit.
function fiatPerAsset(read: Reader, data: JsonObject): string {
  const scaled = amount(read, data, "conversionRate", 18, "down");
  if (scaled === 0n) throw read.fail("conversionRate is zero");
  return toDecimalString(10n ** 28n / scaled, 10);
}

// Codes are fixed upper-case identifiers; anything else is dropped so a message can never echo user data.
function safeCode(value: unknown): string {
  return typeof value === "string" && /^[A-Z0-9_]+$/.test(value) ? value : "unknown";
}

function errorCode(body: unknown): string {
  const error = typeof body === "object" && body !== null ? (body as JsonObject).error : undefined;
  if (typeof error !== "object" || error === null) return "unknown";
  const record = error as JsonObject;
  const context = record.context as JsonObject | undefined;
  const details = Array.isArray(context?.details) ? context.details : [];
  const detail = (details[0] ?? {}) as JsonObject;
  return safeCode(detail.code ?? detail.errorCode ?? record.code);
}

function firstString(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const found = value.find((entry) => typeof entry === "string" && entry !== "");
  return typeof found === "string" ? found : undefined;
}
