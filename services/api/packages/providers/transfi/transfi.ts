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

// Supported Crypto Currencies page: deposit-enabled tickers, which carry the network as a suffix.
const TICKER_SUFFIX: Partial<Record<Chain, { suffix: string; assets: readonly Asset[] }>> = {
  arbitrum: { suffix: "ARB", assets: ["USDC", "USDT"] },
  base: { suffix: "BASE", assets: ["USDC"] },
  bnb: { suffix: "BSC", assets: ["USDC", "USDT"] },
  celo: { suffix: "CELO", assets: ["USDC", "USDT"] },
  polygon: { suffix: "POLYGON", assets: ["USDC", "USDT"] },
  solana: { suffix: "SOL", assets: ["USDC", "USDT"] },
  tron: { suffix: "TRC20", assets: ["USDT"] },
};

const PAYOUT_TYPE: Record<string, PayoutType> = { bank_transfer: "bank", local_wallet: "mobile_money" };
const PAYMENT_TYPE: Record<PayoutType, string> = { bank: "bank_transfer", mobile_money: "local_wallet" };

const ACCOUNT_FIELDS = ["accountNumber", "bankAccountNumber", "account_number", "accountNo"];
const NAME_FIELDS = ["accountName", "accountHolderName", "beneficiaryName"];
const PHONE_FIELDS = ["phone", "phoneNumber", "mobileNumber"];

// The rates endpoint returns no quote id and no expiry ("valid from when you request it"), so we hold a quote briefly.
const QUOTE_TTL_MS = 60_000;
const CAPABILITIES_TTL_MS = 24 * 60 * 60 * 1000;
const CAPABILITIES_RETRY_MS = 5 * 60 * 1000;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const PURPOSE_CODE = "remittance";
const USER_AGENT = "fliq-api";

type Method = {
  code: string;
  name: string;
  payoutType: PayoutType;
  min: bigint;
  max: bigint;
  fields: string[];
};

type Loaded = { capabilities: Capabilities; methods: Map<FiatCurrency, Method[]> };

export function createTransfiAdapter(options: TransfiOptions): TransfiAdapter {
  const now = () => (options.deps.now ?? (() => new Date()))().getTime();
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
    capabilities: { provider: "transfi", custody: "one_time_address", corridors: [], sources, limits: {} },
    methods: new Map(),
  };
  let loadedAt: number | undefined;
  let attemptedAt: number | undefined;
  let inflight: Promise<Capabilities> | null = null;

  function refreshDue(): boolean {
    if (inflight) return false;
    const time = now();
    if (loadedAt !== undefined && time - loadedAt < CAPABILITIES_TTL_MS) return false;
    return attemptedAt === undefined || time - attemptedAt >= CAPABILITIES_RETRY_MS;
  }

  function refreshCapabilities(): Promise<Capabilities> {
    if (inflight) return inflight;
    attemptedAt = now();
    inflight = loadMethods()
      .then((methods) => {
        loaded = { capabilities: buildCapabilities(methods), methods };
        loadedAt = now();
        return loaded.capabilities;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  async function loadMethods(): Promise<Map<FiatCurrency, Method[]>> {
    const methods = new Map<FiatCurrency, Method[]>();
    for (const currency of Object.values(CURRENCY_OF)) {
      if (currency) methods.set(currency, await methodsFor(currency));
    }
    return methods;
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
        if (errorCode(response.body) === "NO_PAYMENT_METHODS_AVAILABLE") return methods;
        throw new ProviderError("transfi", "institutions", "rejected", "payment methods not found", 404);
      }
      const body = read.object(response.body, "body");
      for (const entry of read.array(body.data, "data")) {
        const method = toMethod(read, read.object(entry, "paymentMethod"), currency);
        if (method) methods.push(method);
      }
      const pagination = body.pagination;
      if (
        typeof pagination !== "object" ||
        pagination === null ||
        (pagination as JsonObject).hasNext !== true
      )
        return methods;
    }
    return methods;
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
    return { provider: "transfi", custody: "one_time_address", corridors, sources, limits };
  }

  async function paymentMethod(currency: FiatCurrency, code: string): Promise<Method> {
    if (loadedAt === undefined) await refreshCapabilities();
    const method = loaded.methods.get(currency)?.find((entry) => entry.code === code);
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
      case "expired":
      case "cancelled":
        return { status: "failed", code: status, retryable: true };
      // asset_settle_failed is left out on purpose: the docs do not say whether the crypto had arrived.
      default:
        return null;
    }
  }

  function unmappable(operation: "getOrder" | "parseWebhook", value: string): ProviderError {
    options.deps.alert({ provider: "transfi", kind: "unmappable_status", detail: `${operation} ${value}` });
    return new ProviderError("transfi", operation, "unmappable_status", value);
  }

  function snapshot(order: JsonObject, reference?: string): OrderSnapshot {
    const read = jsonReader("transfi", "getOrder");
    const status = read.string(order, "status");
    const mapped = toStatus(status, order);
    if (!mapped) throw unmappable("getOrder", status);
    return { providerOrderId: read.string(order, "id"), ...(reference ? { reference } : {}), ...mapped };
  }

  function paymentDetails(method: Method, recipient: Recipient): Record<string, string> {
    if (method.payoutType === "mobile_money") {
      const phone = (recipient.phone ?? recipient.accountNumber).replace(/\D/g, "");
      const keys = method.fields.filter((field) => PHONE_FIELDS.includes(field));
      return Object.fromEntries((keys.length > 0 ? keys : ["phone"]).map((key) => [key, phone]));
    }
    const details: Record<string, string> = {};
    for (const field of method.fields) {
      if (ACCOUNT_FIELDS.includes(field)) details[field] = recipient.accountNumber;
      else if (NAME_FIELDS.includes(field)) details[field] = recipient.accountName;
      else if (PHONE_FIELDS.includes(field) && recipient.phone)
        details[field] = recipient.phone.replace(/\D/g, "");
    }
    // Guessing a field name could let TransFi accept the order and fail it after the crypto arrives.
    if (!ACCOUNT_FIELDS.some((field) => field in details)) {
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
        body: { orderId, reason: "not priced at the quote" },
      })
      .catch(() => undefined);
  }

  function fundingFrom(data: JsonObject, request: CreateOrderRequest) {
    const read = jsonReader("transfi", "createOrder");
    const asset = request.source.asset;
    const units = amount(read, data, "cryptoAmount", ASSET_DECIMALS[asset], "up");
    if (units > request.quote.sendUnits)
      throw new ProviderError("transfi", "createOrder", "rejected", "order not priced at the quote");
    return {
      kind: "deposit_address" as const,
      chain: request.source.chain,
      asset,
      address: read.string(data, "walletAddress"),
      units,
    };
  }

  return {
    id: "transfi",

    capabilities() {
      if (refreshDue()) refreshCapabilities().catch(() => undefined);
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
      const receiveMinorUnits = amount(read, data, "destinationAmount", fiatDecimals, "down");
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
        // The off-ramp webhook sample shows the fee in the fiat currency, charged on the gross fiat amount.
        fees: [
          { kind: "provider", amount: amount(read, data, "totalFee", fiatDecimals, "down"), unit: currency },
        ],
        expiresAt: new Date(now() + QUOTE_TTL_MS),
      };
    },

    async createOrder(request) {
      const read = jsonReader("transfi", "createOrder");
      const currency = currencyFor(request.corridor, "createOrder");
      const sourceCurrency = ticker(request.source, "createOrder");
      const method = await paymentMethod(currency, request.recipient.institutionCode);
      if (method.payoutType !== request.corridor.payoutType)
        throw new ProviderError(
          "transfi",
          "createOrder",
          "rejected",
          "payment code is for another payout type",
        );
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
          source: { currency: sourceCurrency },
          // Fixing the fiat side guarantees the quoted receive amount; the crypto it asks for is checked below.
          destination: {
            currency,
            amount: Number(toDecimalString(request.quote.receiveMinorUnits, FIAT_DECIMALS[currency])),
            paymentType: PAYMENT_TYPE[method.payoutType],
            paymentCode: method.code,
            additionalPaymentDetails: paymentDetails(method, request.recipient),
          },
        },
      });
      if (response.status === 400) {
        throw new ProviderError("transfi", "createOrder", "rejected", errorCode(response.body), 400);
      }
      const data = read.object(read.object(response.body, "body").data, "data");
      const orderId = read.string(data, "orderId");
      try {
        return { providerOrderId: orderId, reference: request.payoutId, funding: fundingFrom(data, request) };
      } catch (error) {
        await cancelQuietly(orderId);
        throw error;
      }
    },

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
        if (errorCode(response.body) === "TRANSFER_NOT_FOUND") return null;
        throw new ProviderError("transfi", "getOrder", "rejected", errorCode(response.body), 400);
      }
      const read = jsonReader("transfi", "getOrder");
      const data = read.object(read.object(response.body, "body").data, "data");
      return snapshot(data, "reference" in lookup ? lookup.reference : undefined);
    },

    async verifyAccount() {
      throw new ProviderError(
        "transfi",
        "verifyAccount",
        "not_supported",
        "no account lookup in the TransFi API",
      );
    },

    async institutions(country) {
      const currency = CURRENCY_OF[country];
      if (!currency) return [];
      await refreshCapabilities();
      return (loaded.methods.get(currency) ?? []).map(
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
      if (entityType !== "order") throw unmappable("parseWebhook", `entityType ${entityType}`);
      const order = read.object(body.order, "order");
      // Webhooks call an off-ramp order "sell" where the REST API says "offramp".
      const type = read.string(order, "type");
      if (type !== "sell") throw unmappable("parseWebhook", `order type ${type}`);
      const status = read.string(body, "status");
      const mapped = toStatus(status, order);
      if (!mapped) throw unmappable("parseWebhook", status);
      const entityId = read.string(body, "entityId");
      // The docs' samples reuse one eventId across statuses and say to key on entityId + status.
      return {
        eventId: `${entityId}:${status}`,
        providerOrderId: read.string(order, "orderId"),
        order: mapped,
      };
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
function errorCode(body: unknown): string {
  const error = typeof body === "object" && body !== null ? (body as JsonObject).error : undefined;
  if (typeof error !== "object" || error === null) return "unknown";
  const record = error as JsonObject;
  const context = record.context as JsonObject | undefined;
  const details = Array.isArray(context?.details) ? context.details : [];
  const detail = (details[0] ?? {}) as JsonObject;
  const code = detail.code ?? detail.errorCode ?? record.code;
  return typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? code : "unknown";
}

function firstString(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const found = value.find((entry) => typeof entry === "string" && entry !== "");
  return typeof found === "string" ? found : undefined;
}
