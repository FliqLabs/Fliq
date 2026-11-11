import { randomBytes } from "node:crypto";
import { hmac, verifyHmac } from "../../webhooks/hmac";
import { ProviderError } from "../errors";
import { createProviderHttp } from "../http";
import { jsonReader, type JsonObject } from "../json";
import { ASSET_DECIMALS, FIAT_DECIMALS, toDecimalString } from "../money";
import type {
  AccountVerification,
  AdapterDeps,
  Capabilities,
  Chain,
  Corridor,
  Institution,
  OrderSnapshot,
  OrderStatus,
  ProviderAdapter,
  ProviderQuote,
  QuoteRequest,
  Recipient,
  SourceAsset,
} from "../types";

// Sources: services/Project MD/EXTERNAL_ADAPTERS/BITNOB.md, verified against
// bitnob.dev/api-collections/swagger/bitnob-api-v2.openapi.json, the payout lifecycle and the Ghana corridor page.
export const BITNOB_BASE_URL = "https://api.bitnob.com";
export const BITNOB_SIGNATURE_HEADER = "x-bitnob-signature";
export const BITNOB_EVENT_ID_HEADER = "x-bitnob-event-id";

// Numbers port between Ghana networks, so the network the sender picked is trusted and only the format is checked.
const GH_MOBILE_NETWORKS: Record<string, string> = {
  mtn: "MTN MoMo",
  vodafone: "Telecel Cash",
  airtel: "AirtelTigo Money",
};

// Ghana bank payouts are off by default: Account Lookup cannot verify Ghana bank accounts (ARCH §16.1).
const DEFAULT_CORRIDORS: readonly Corridor[] = [
  { country: "GH", currency: "GHS", payoutType: "mobile_money" },
];

// Chains Bitnob lists for USDC/USDT in GET /api/stablecoins/supported-chains, plus Tron from its on-chain payout
// example. Stellar is left out: Bitnob returns no memo with a deposit address.
const BITNOB_CHAINS: Partial<Record<Chain, string>> = {
  base: "BASE",
  polygon: "POLYGON",
  solana: "SOLANA",
  ethereum: "ETHEREUM",
  tron: "TRON",
};

// Routing takes the first reachable source for a 1Click hop, so the cheapest chains come first.
const SOURCES: readonly SourceAsset[] = [
  { asset: "USDC", chain: "base" },
  { asset: "USDC", chain: "polygon" },
  { asset: "USDT", chain: "polygon" },
  { asset: "USDC", chain: "solana" },
  { asset: "USDT", chain: "solana" },
  { asset: "USDC", chain: "ethereum" },
  { asset: "USDT", chain: "ethereum" },
  { asset: "USDT", chain: "tron" },
];

const MOBILE_MONEY_SETTLE_SECONDS = 60;

// Bitnob has no lookup by reference. A payout is created at quote time and a quote lives minutes, so an order a
// timed-out createOrder may have made is always among the most recent ones.
const REFERENCE_WINDOW_MS = 24 * 60 * 60 * 1000;
const REFERENCE_PAGE_SIZE = 50;
const REFERENCE_MAX_PAGES = 10;

const WEBHOOK_EVENTS: Record<string, OrderStatus> = {
  "payouts.initialized": { status: "awaiting_deposit" },
  "payouts.processing": { status: "processing" },
  "payouts.withdrawal.success": { status: "paid" },
  "payouts.withdrawal.expired": { status: "failed", code: "deposit_expired", retryable: true },
  "payouts.withdrawal.failed": { status: "refunding" },
};

// Bitnob never returns a deposit on-chain: a failed or underpaid payout is credited to our Bitnob balance.
const CUSTODIAL_REFUND_STATUSES: ReadonlySet<string> = new Set(["FAILED", "UNDERPAYMENT"]);
const CUSTODIAL_REFUND_EVENT = "payouts.withdrawal.failed";

export type BitnobOptions = {
  clientId: string;
  clientSecret: string;
  webhookSecrets: readonly string[];
  expectedEnvironment: "sandbox" | "production";
  callbackUrl?: string;
  corridors?: readonly Corridor[];
  deps: AdapterDeps;
  baseUrl?: string;
  maxConcurrent?: number;
  nonce?: () => string;
};

export function createBitnobAdapter(options: BitnobOptions): ProviderAdapter {
  const now = options.deps.now ?? (() => new Date());
  const nonce = options.nonce ?? (() => randomBytes(16).toString("hex"));
  const corridors = options.corridors ?? DEFAULT_CORRIDORS;
  const http = createProviderHttp({
    provider: "bitnob",
    baseUrl: options.baseUrl ?? BITNOB_BASE_URL,
    maxConcurrent: options.maxConcurrent ?? 8,
    ...(options.deps.fetch ? { fetch: options.deps.fetch } : {}),
    authHeaders: ({ body }) => {
      const timestamp = Math.floor(now().getTime() / 1000).toString();
      const requestNonce = nonce();
      const payload = `${options.clientId}:${timestamp}:${requestNonce}:${body}`;
      return {
        "content-type": "application/json",
        "X-Auth-Client": options.clientId,
        "X-Auth-Timestamp": timestamp,
        "X-Auth-Nonce": requestNonce,
        "X-Auth-Signature": hmac("sha256", options.clientSecret, payload, "hex"),
      };
    },
  });

  const capabilities: Capabilities = {
    provider: "bitnob",
    custody: "per_order_address",
    corridors: [...corridors],
    sources: [...SOURCES],
    // GET /api/payouts/limits: GH GHS min "20", max "15000" (major units).
    limits: { GHS: { side: "receive", min: 2_000n, max: 1_500_000n } },
    sandbox: options.expectedEnvironment === "sandbox",
  };

  function supports(corridor: Corridor): boolean {
    return corridors.some(
      (entry) =>
        entry.country === corridor.country &&
        entry.currency === corridor.currency &&
        entry.payoutType === corridor.payoutType,
    );
  }

  function bitnobChain(source: SourceAsset, operation: "quote" | "createOrder"): string {
    const chain = BITNOB_CHAINS[source.chain];
    const listed = SOURCES.some((entry) => entry.asset === source.asset && entry.chain === source.chain);
    if (!chain || !listed) {
      throw new ProviderError("bitnob", operation, "not_supported", `${source.asset} on ${source.chain}`);
    }
    return chain;
  }

  function unmappable(operation: "getOrder" | "parseWebhook", value: string): ProviderError {
    options.deps.alert({ provider: "bitnob", kind: "unmappable_status", detail: `${operation} ${value}` });
    return new ProviderError("bitnob", operation, "unmappable_status", value);
  }

  // The payout poller reads a refunding order every few seconds; an operator needs one alert per order, not one per read.
  const refundsAlerted = new Set<string>();
  function custodialRefund(detail: string): void {
    if (refundsAlerted.has(detail)) return;
    refundsAlerted.add(detail);
    options.deps.alert({ provider: "bitnob", kind: "custodial_refund", detail });
  }

  function payout(body: unknown, operation: "quote" | "createOrder" | "getOrder"): JsonObject {
    const read = jsonReader("bitnob", operation);
    return read.object(read.object(read.object(body, "body").data, "data").payout, "payout");
  }

  function snapshot(record: JsonObject): OrderSnapshot {
    const read = jsonReader("bitnob", "getOrder");
    const status = read.string(record, "status");
    const order = toStatus(status, record);
    if (!order) throw unmappable("getOrder", status);
    const providerOrderId = read.string(record, "id");
    if (CUSTODIAL_REFUND_STATUSES.has(status)) {
      custodialRefund(`payout ${providerOrderId} is ${status}; its deposit sits in the Bitnob balance`);
    }
    const reference = read.optionalString(record, "reference");
    return { providerOrderId, ...(reference ? { reference } : {}), ...order };
  }

  async function requestQuote(request: QuoteRequest, chain: string, amount: JsonObject) {
    const read = jsonReader("bitnob", "quote");
    const response = await http.request({
      operation: "quote",
      method: "POST",
      path: "/api/payouts/quotes",
      body: {
        from_asset: request.source.asset,
        to_currency: request.corridor.currency,
        source: "onchain",
        chain,
        country: request.corridor.country,
        ...amount,
      },
    });
    const record = payout(response.body, "quote");
    if (read.string(record, "to_currency").toUpperCase() !== request.corridor.currency) {
      throw read.fail("to_currency differs from the request");
    }
    const decimals = ASSET_DECIMALS[request.source.asset];
    return {
      record,
      total: read.units(record, "total_amount", decimals),
      fee: read.units(record, "source_fee", decimals),
    };
  }

  async function lookup(query: Record<string, string>): Promise<AccountVerification> {
    const read = jsonReader("bitnob", "verifyAccount");
    const response = await http.request({
      operation: "verifyAccount",
      method: "GET",
      path: "/api/payouts/account-lookup",
      query,
      acceptStatuses: [400, 404],
    });
    if (response.status === 400) return lookupRefusal(response.body);
    if (response.status === 404) return { found: false };
    const data = read.object(read.object(response.body, "body").data, "data");
    if (data.is_verified !== true) return { found: false };
    return { found: true, accountName: read.string(data, "account_name") };
  }

  async function findByReference(reference: string): Promise<OrderSnapshot | null> {
    const read = jsonReader("bitnob", "getOrder");
    const since = new Date(now().getTime() - REFERENCE_WINDOW_MS).toISOString();
    for (let page = 0; page < REFERENCE_MAX_PAGES; page++) {
      const response = await http.request({
        operation: "getOrder",
        method: "GET",
        path: "/api/payouts",
        query: {
          limit: String(REFERENCE_PAGE_SIZE),
          offset: String(page * REFERENCE_PAGE_SIZE),
          source: "onchain",
          from_date: since,
        },
      });
      const data = read.object(read.object(response.body, "body").data, "data");
      for (const item of read.array(data.items, "items")) {
        const record = read.object(item, "item");
        if (record.reference === reference) return snapshot(record);
      }
      if (data.has_more !== true) return null;
    }
    throw new ProviderError("bitnob", "getOrder", "unavailable", "reference not found in the payouts read");
  }

  return {
    id: "bitnob",

    capabilities: () => capabilities,

    async quote(request) {
      if (!supports(request.corridor)) {
        throw new ProviderError("bitnob", "quote", "not_supported", `corridor ${request.corridor.country}`);
      }
      const chain = bitnobChain(request.source, "quote");
      if (request.amount.side === "receive") {
        const settlement = toDecimalString(
          request.amount.minorUnits,
          FIAT_DECIMALS[request.corridor.currency],
        );
        const quoted = await requestQuote(request, chain, { settlement_amount: settlement });
        return toQuote(request, quoted.record, quoted.total, quoted.fee);
      }
      const units = request.amount.units;
      let quoted = await requestQuote(request, chain, { amount_in_base_units: units.toString() });
      // Bitnob adds source_fee on top of the amount, so the fee is taken out of the amount to send exactly.
      if (quoted.total > units && units > quoted.fee) {
        quoted = await requestQuote(request, chain, {
          amount_in_base_units: (units - quoted.fee).toString(),
        });
      }
      if (quoted.total > units) {
        throw new ProviderError("bitnob", "quote", "rejected", "fee leaves too little to send");
      }
      return toQuote(request, quoted.record, quoted.total, quoted.fee);
    },

    async createOrder(request) {
      const read = jsonReader("bitnob", "createOrder");
      const quoteId = request.quote.providerQuoteId;
      if (!quoteId)
        throw new ProviderError("bitnob", "createOrder", "rejected", "quote has no Bitnob quote_id");
      const chain = bitnobChain(request.source, "createOrder");
      const beneficiary = beneficiaryFor(request.corridor, request.recipient);
      // Bitnob finalizes an on-chain payout itself once the deposit confirms; finalize is never called.
      const response = await http.request({
        operation: "createOrder",
        method: "POST",
        path: `/api/payouts/${encodeURIComponent(quoteId)}/initialize`,
        body: {
          reference: request.payoutId,
          beneficiary,
          ...(options.callbackUrl ? { callback_url: options.callbackUrl } : {}),
        },
      });
      const record = payout(response.body, "createOrder");
      const status = read.string(record, "status");
      if (status !== "PENDING_ADDRESS_DEPOSIT") throw read.fail(`status ${status} is not awaiting a deposit`);
      const returnedChain = read.optionalString(record, "chain");
      if (returnedChain && returnedChain.replace(/^CHAIN_TYPE_/, "") !== chain) {
        throw read.fail("chain differs from the request");
      }
      const decimals = ASSET_DECIMALS[request.source.asset];
      const units = record.deposit_amount
        ? read.units(record, "deposit_amount", decimals)
        : read.units(record, "total_amount", decimals);
      // Initialize can price a fee the quote did not show; a larger deposit would leave a hop short.
      if (units > request.quote.sendUnits) {
        throw new ProviderError("bitnob", "createOrder", "rejected", "deposit is more than the quote");
      }
      return {
        providerOrderId: read.string(record, "id"),
        reference: request.payoutId,
        funding: {
          kind: "deposit_address",
          chain: request.source.chain,
          asset: request.source.asset,
          address: read.string(record, "address"),
          units,
          validUntil: read.date(record, "expires_at"),
        },
      };
    },

    async getOrder(lookup) {
      if ("reference" in lookup) return findByReference(lookup.reference);
      const response = await http.request({
        operation: "getOrder",
        method: "GET",
        path: `/api/payouts/${encodeURIComponent(lookup.providerOrderId)}`,
        acceptStatuses: [404],
      });
      return response.status === 404 ? null : snapshot(payout(response.body, "getOrder"));
    },

    async verifyAccount(check) {
      if (check.country !== "GH") {
        return lookup({
          country: check.country,
          bank_code: check.institutionCode,
          account_number: check.accountNumber,
        });
      }
      const network = check.institutionCode.toLowerCase();
      if (isGhanaNetwork(network)) {
        const accountNumber = ghanaNationalNumber(check.accountNumber, "verifyAccount");
        if (network !== "mtn") return { found: true, accountName: null };
        return lookup({
          country: "GH",
          type: "mobile_money",
          bank_code: "MTN",
          account_number: accountNumber,
        });
      }
      if (!supports({ country: "GH", currency: "GHS", payoutType: "bank" })) {
        throw new ProviderError("bitnob", "verifyAccount", "not_supported", "Ghana bank payouts are off");
      }
      return /^\d+$/.test(check.accountNumber) ? { found: true, accountName: null } : { found: false };
    },

    async institutions(country) {
      const read = jsonReader("bitnob", "institutions");
      const types = corridors
        .filter((corridor) => corridor.country === country)
        .map((corridor) => corridor.payoutType);
      const result: Institution[] = [];
      if (types.includes("mobile_money") && country === "GH") {
        for (const [code, name] of Object.entries(GH_MOBILE_NETWORKS)) {
          result.push({ code, name, type: "mobile_money" });
        }
      }
      if (types.includes("bank")) {
        const response = await http.request({
          operation: "institutions",
          method: "GET",
          path: `/api/payouts/banks/${country}`,
        });
        const banks = read.array(read.object(read.object(response.body, "body").data, "data").banks, "banks");
        for (const entry of banks) {
          const bank = read.object(entry, "bank");
          result.push({
            code: read.string(bank, "bank_code"),
            name: read.string(bank, "bank_name"),
            type: "bank",
          });
        }
      }
      return result;
    },

    parseWebhook(webhook) {
      const read = jsonReader("bitnob", "parseWebhook");
      const valid = verifyHmac({
        algorithm: "sha512",
        encoding: "hex",
        secrets: options.webhookSecrets,
        payload: webhook.rawBody,
        signature: webhook.headers[BITNOB_SIGNATURE_HEADER],
      });
      if (!valid) {
        options.deps.alert({
          provider: "bitnob",
          kind: "invalid_signature",
          detail: "webhook signature mismatch",
        });
        throw new ProviderError("bitnob", "parseWebhook", "invalid_signature", "signature mismatch");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(webhook.rawBody);
      } catch {
        throw read.fail("body is not JSON");
      }
      const body = read.object(parsed, "body");
      const event = read.string(body, "event");
      const order = WEBHOOK_EVENTS[event];
      if (!order) throw unmappable("parseWebhook", event);
      const data = read.object(body.data, "data");
      const reference = read.optionalString(data, "reference");
      const providerOrderId = read.optionalString(data, "id");
      if (event === CUSTODIAL_REFUND_EVENT) {
        custodialRefund(
          `payout ${providerOrderId ?? "unknown"} failed; its deposit sits in the Bitnob balance`,
        );
      }
      return {
        eventId: webhook.headers[BITNOB_EVENT_ID_HEADER] ?? read.string(body, "event_id"),
        ...(providerOrderId ? { providerOrderId } : {}),
        ...(reference ? { reference } : {}),
        order,
      };
    },

    async health() {
      const response = await http.request({ operation: "health", method: "GET", path: "/api/whoami" });
      const data = (response.body as { data?: { active?: unknown; environment?: unknown } } | null)?.data;
      const expected = options.expectedEnvironment === "production" ? "live" : "sandbox";
      return { healthy: data?.active === true && data.environment === expected };
    },

    async balance(asset) {
      const read = jsonReader("bitnob", "balance");
      const response = await http.request({
        operation: "balance",
        method: "GET",
        path: `/api/balances/${asset}`,
      });
      return read.units(read.object(read.object(response.body, "body").data, "data"), "total_balance", 0);
    },
  };
}

function toQuote(request: QuoteRequest, record: JsonObject, total: bigint, fee: bigint): ProviderQuote {
  const read = jsonReader("bitnob", "quote");
  return {
    provider: "bitnob",
    providerQuoteId: read.string(record, "quote_id"),
    sendUnits: total,
    receiveMinorUnits: read.units(
      record,
      "settlement_amount",
      FIAT_DECIMALS[request.corridor.currency],
      "down",
    ),
    rate: read.string(read.object(record.exchange_rate, "exchange_rate"), "effective_rate"),
    fees: [{ kind: "provider", amount: fee, unit: request.source.asset }],
    ...(request.corridor.payoutType === "mobile_money"
      ? { estimatedSettleSeconds: MOBILE_MONEY_SETTLE_SECONDS }
      : {}),
    expiresAt: read.date(record, "expires_at"),
  };
}

function toStatus(status: string, record: JsonObject): OrderStatus | null {
  switch (status) {
    case "INITIATED":
    case "PENDING_ADDRESS_DEPOSIT":
      return { status: "awaiting_deposit" };
    case "PENDING":
    case "PROCESSING":
      return { status: "processing" };
    case "SUCCESS": {
      const settlement = record.provider_settlement_id;
      return typeof settlement === "string" && settlement !== ""
        ? { status: "paid", fiatReference: settlement }
        : { status: "paid" };
    }
    case "FAILED":
    case "UNDERPAYMENT":
      return { status: "refunding" };
    case "EXPIRED":
      return { status: "failed", code: "deposit_expired", retryable: true };
    default:
      return null;
  }
}

// The lookup answers 400 both for "no such account" and for a corridor or partner outage; only the first is a no.
function lookupRefusal(body: unknown): AccountVerification {
  const problem = (body ?? {}) as {
    code?: unknown;
    detail?: unknown;
    extensions?: { reason?: unknown };
    error?: { code?: unknown };
  };
  const code = problem.code ?? problem.error?.code;
  if (
    problem.extensions?.reason === "route_disabled" ||
    code === "TIMEOUT" ||
    code === "SERVICE_UNAVAILABLE"
  ) {
    throw new ProviderError("bitnob", "verifyAccount", "unavailable", "lookup is unavailable", 400);
  }
  if (typeof problem.detail === "string" && problem.detail.startsWith("Unable to verify account details")) {
    return { found: false };
  }
  throw new ProviderError("bitnob", "verifyAccount", "rejected", "http 400", 400);
}

function beneficiaryFor(corridor: Corridor, recipient: Recipient): JsonObject {
  const base = {
    country: corridor.country,
    account_name: recipient.accountName,
  };
  if (corridor.payoutType === "bank") {
    return {
      ...base,
      destination_type: "bank",
      account_number: recipient.accountNumber,
      bank_code: recipient.institutionCode,
    };
  }
  const network = recipient.institutionCode.toLowerCase();
  if (corridor.country !== "GH" || !isGhanaNetwork(network)) {
    throw new ProviderError(
      "bitnob",
      "createOrder",
      "not_supported",
      `mobile network ${recipient.institutionCode}`,
    );
  }
  const accountNumber = ghanaNationalNumber(recipient.accountNumber, "createOrder");
  return { ...base, destination_type: "mobile_money", account_number: accountNumber, network };
}

function isGhanaNetwork(network: string): boolean {
  return Object.hasOwn(GH_MOBILE_NETWORKS, network);
}

// Bitnob's initialize example uses the national 0XXXXXXXXX form; lookup accepts it too.
function ghanaNationalNumber(input: string, operation: "createOrder" | "verifyAccount"): string {
  const digits = input.replace(/\D/g, "");
  if (/^0\d{9}$/.test(digits)) return digits;
  if (/^233\d{9}$/.test(digits)) return `0${digits.slice(3)}`;
  throw new ProviderError("bitnob", operation, "rejected", "mobile number is not a Ghana number");
}
