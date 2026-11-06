import { randomBytes } from "node:crypto";
import { hmac, verifyHmac } from "../../webhooks/hmac";
import { ProviderError } from "../errors";
import { OPERATION_TIMEOUT_MS, createProviderHttp } from "../http";
import { jsonReader, type JsonObject } from "../json";
import { ASSET_DECIMALS, FIAT_DECIMALS, toDecimalString } from "../money";
import type {
  AdapterDeps,
  Asset,
  Capabilities,
  Corridor,
  Institution,
  OrderSnapshot,
  OrderStatus,
  ProviderAdapter,
  Recipient,
} from "../types";

// Sources: services/Project MD/EXTERNAL_ADAPTERS/BITNOB.md, verified against
// bitnob.dev/api-collections/swagger/bitnob-api-v2.openapi.json and the Ghana corridor page.
export const BITNOB_BASE_URL = "https://api.bitnob.com";
export const BITNOB_SIGNATURE_HEADER = "x-bitnob-signature";
export const BITNOB_EVENT_ID_HEADER = "x-bitnob-event-id";

// Ghana Mobile Money network values and national prefixes, from Bitnob's Ghana corridor page.
const GH_MOBILE_NETWORKS: Record<string, { name: string; prefixes: readonly string[] }> = {
  mtn: { name: "MTN MoMo", prefixes: ["24", "54", "25", "55", "59"] },
  vodafone: { name: "Telecel Cash", prefixes: ["20", "50"] },
  airtel: { name: "AirtelTigo Money", prefixes: ["26", "56"] },
};

// Ghana bank payouts are off by default: Account Lookup cannot verify Ghana bank accounts (ARCH §16.1).
const DEFAULT_CORRIDORS: readonly Corridor[] = [
  { country: "GH", currency: "GHS", payoutType: "mobile_money" },
];

const WEBHOOK_EVENTS: Record<string, OrderStatus> = {
  "payouts.initialized": { status: "awaiting_deposit" },
  "payouts.processing": { status: "processing" },
  "payouts.withdrawal.success": { status: "paid" },
  "payouts.withdrawal.expired": { status: "failed", code: "quote_expired", retryable: true },
};

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

export type FloatBalance = { available: bigint; pending: bigint; total: bigint };

export type BitnobAdapter = ProviderAdapter & { floatBalance(asset: Asset): Promise<FloatBalance> };

export function createBitnobAdapter(options: BitnobOptions): BitnobAdapter {
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

  // Sources are the float top-up chains from GET /api/stablecoins/supported-chains (Avalanche and Optimism have
  // no Chain value yet); payouts themselves debit the float, not a per-order deposit.
  const capabilities: Capabilities = {
    provider: "bitnob",
    custody: "prefunded_balance",
    corridors: [...corridors],
    sources: [
      { asset: "USDT", chain: "ethereum" },
      { asset: "USDT", chain: "polygon" },
      { asset: "USDT", chain: "solana" },
      { asset: "USDC", chain: "base" },
      { asset: "USDC", chain: "ethereum" },
      { asset: "USDC", chain: "polygon" },
      { asset: "USDC", chain: "solana" },
      { asset: "USDC", chain: "stellar" },
    ],
    // GET /api/payouts/limits: GH GHS min "20", max "15000" (major units).
    limits: { GHS: { side: "receive", min: 2_000n, max: 1_500_000n } },
  };

  function supports(corridor: Corridor): boolean {
    return corridors.some(
      (entry) =>
        entry.country === corridor.country &&
        entry.currency === corridor.currency &&
        entry.payoutType === corridor.payoutType,
    );
  }

  function unmappable(operation: "getOrder" | "parseWebhook", value: string): ProviderError {
    options.deps.alert({ provider: "bitnob", kind: "unmappable_status", detail: `${operation} ${value}` });
    return new ProviderError("bitnob", operation, "unmappable_status", value);
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
    const reference = read.optionalString(record, "reference");
    return { providerOrderId: read.string(record, "id"), ...(reference ? { reference } : {}), ...order };
  }

  async function readPayout(path: string): Promise<OrderSnapshot | null> {
    const response = await http.request({
      operation: "getOrder",
      method: "GET",
      path,
      acceptStatuses: [404],
    });
    return response.status === 404 ? null : snapshot(payout(response.body, "getOrder"));
  }

  return {
    id: "bitnob",

    capabilities: () => capabilities,

    async quote(request) {
      const read = jsonReader("bitnob", "quote");
      if (!supports(request.corridor)) {
        throw new ProviderError("bitnob", "quote", "not_supported", `corridor ${request.corridor.country}`);
      }
      if (request.amount.side !== "receive") {
        throw new ProviderError("bitnob", "quote", "not_supported", "quote amount units are unconfirmed");
      }
      const response = await http.request({
        operation: "quote",
        method: "POST",
        path: "/api/payouts/quotes",
        body: {
          from_asset: request.source.asset,
          to_currency: request.corridor.currency,
          source: "offchain",
          country: request.corridor.country,
          settlement_amount: toDecimalString(
            request.amount.minorUnits,
            FIAT_DECIMALS[request.corridor.currency],
          ),
          reference: request.quoteId,
        },
      });
      const record = payout(response.body, "quote");
      if (read.string(record, "to_currency").toUpperCase() !== request.corridor.currency) {
        throw read.fail("to_currency differs from the request");
      }
      const assetDecimals = ASSET_DECIMALS[request.source.asset];
      return {
        provider: "bitnob",
        providerQuoteId: read.string(record, "quote_id"),
        sendUnits: read.units(record, "amount", assetDecimals),
        receiveMinorUnits: read.units(record, "cent_amount", 0),
        rate: read.string(read.object(record.exchange_rate, "exchange_rate"), "effective_rate"),
        fees: [
          { kind: "provider", amount: read.units(record, "fees", assetDecimals), unit: request.source.asset },
        ],
        expiresAt: read.date(record, "expires_at"),
      };
    },

    async createOrder(request) {
      const read = jsonReader("bitnob", "createOrder");
      const quoteId = request.quote.providerQuoteId;
      if (!quoteId)
        throw new ProviderError("bitnob", "createOrder", "rejected", "quote has no Bitnob quote_id");
      const beneficiary = beneficiaryFor(request.corridor, request.recipient);
      const deadline = Date.now() + OPERATION_TIMEOUT_MS.createOrder;
      const path = `/api/payouts/${encodeURIComponent(quoteId)}`;
      await http.request({
        operation: "createOrder",
        method: "POST",
        path: `${path}/initialize`,
        body: {
          reference: request.payoutId,
          beneficiary,
          ...(options.callbackUrl ? { callback_url: options.callbackUrl } : {}),
        },
        deadline,
      });
      // A failure between these calls leaves the payout INITIATED with nothing debited; reconciliation sees it
      // through getOrder by reference and the quote then expires, so no second debit is possible.
      const finalized = await http.request({
        operation: "createOrder",
        method: "POST",
        path: `${path}/finalize`,
        deadline,
      });
      const record = payout(finalized.body, "createOrder");
      return {
        providerOrderId: read.string(record, "id"),
        reference: request.payoutId,
        funding: {
          kind: "balance_debit",
          asset: request.source.asset,
          units: read.units(record, "amount", ASSET_DECIMALS[request.source.asset]),
        },
      };
    },

    getOrder(lookup) {
      return "reference" in lookup
        ? readPayout(`/api/payouts/reference/${encodeURIComponent(lookup.reference)}`)
        : readPayout(`/api/payouts/${encodeURIComponent(lookup.providerOrderId)}`);
    },

    async verifyAccount(check) {
      const read = jsonReader("bitnob", "verifyAccount");
      const network = GH_MOBILE_NETWORKS[check.institutionCode.toLowerCase()];
      if (check.country === "GH" && !network) {
        throw new ProviderError(
          "bitnob",
          "verifyAccount",
          "not_supported",
          "Ghana bank accounts cannot be looked up",
        );
      }
      if (network && check.institutionCode.toLowerCase() !== "mtn") {
        throw new ProviderError(
          "bitnob",
          "verifyAccount",
          "not_supported",
          "lookup is documented for MTN only",
        );
      }
      const query = network
        ? {
            country: check.country,
            type: "mobile_money",
            bank_code: "MTN",
            account_number: ghanaMsisdn(check.accountNumber, "verifyAccount"),
          }
        : { country: check.country, bank_code: check.institutionCode, account_number: check.accountNumber };
      const response = await http.request({
        operation: "verifyAccount",
        method: "GET",
        path: "/api/payouts/account-lookup",
        query,
        acceptStatuses: [404],
      });
      if (response.status === 404) return { found: false };
      const data = read.object(read.object(response.body, "body").data, "data");
      if (data.is_verified !== true) return { found: false };
      return { found: true, accountName: read.string(data, "account_name") };
    },

    async institutions(country) {
      const read = jsonReader("bitnob", "institutions");
      const types = corridors
        .filter((corridor) => corridor.country === country)
        .map((corridor) => corridor.payoutType);
      const result: Institution[] = [];
      if (types.includes("mobile_money") && country === "GH") {
        for (const [code, network] of Object.entries(GH_MOBILE_NETWORKS)) {
          result.push({ code, name: network.name, type: "mobile_money" });
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
      return { healthy: data?.active === true && data.environment === options.expectedEnvironment };
    },

    async floatBalance(asset) {
      const read = jsonReader("bitnob", "balance");
      const response = await http.request({
        operation: "balance",
        method: "GET",
        path: `/api/balances/${asset}`,
      });
      const data = read.object(read.object(response.body, "body").data, "data");
      return {
        available: read.units(data, "available_balance", 0),
        pending: read.units(data, "pending_balance", 0),
        total: read.units(data, "total_balance", 0),
      };
    },
  };
}

function toStatus(status: string, record: JsonObject): OrderStatus | null {
  switch (status) {
    case "INITIATED":
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
      return { status: "failed", code: "provider_failed", retryable: false };
    default:
      return null;
  }
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
  const known = GH_MOBILE_NETWORKS[network];
  if (corridor.country !== "GH" || !known) {
    throw new ProviderError(
      "bitnob",
      "createOrder",
      "not_supported",
      `mobile network ${recipient.institutionCode}`,
    );
  }
  const msisdn = ghanaMsisdn(recipient.accountNumber, "createOrder");
  // Bitnob lists "Wrong Network" as a failure mode, so a number on another network is refused before ordering.
  if (!known.prefixes.includes(msisdn.slice(3, 5))) {
    throw new ProviderError("bitnob", "createOrder", "rejected", "mobile number does not match the network");
  }
  return { ...base, destination_type: "mobile_money", account_number: msisdn, network };
}

// Bitnob's Ghana page asks for international format without "+", e.g. 23324xxxxxxx.
function ghanaMsisdn(input: string, operation: "createOrder" | "verifyAccount"): string {
  const digits = input.replace(/\D/g, "");
  if (/^233\d{9}$/.test(digits)) return digits;
  if (/^0\d{9}$/.test(digits)) return `233${digits.slice(1)}`;
  throw new ProviderError("bitnob", operation, "rejected", "mobile number is not a Ghana number");
}
