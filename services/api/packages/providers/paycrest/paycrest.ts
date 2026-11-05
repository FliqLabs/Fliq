import { verifyHmac } from "../../webhooks/hmac";
import { ProviderError } from "../errors";
import { createProviderHttp } from "../http";
import { jsonReader, type JsonObject } from "../json";
import { ASSET_DECIMALS, FIAT_DECIMALS, InvalidAmountError, convertAtRate, toDecimalString } from "../money";
import type {
  AdapterDeps,
  Capabilities,
  Chain,
  Country,
  FiatCurrency,
  OrderSnapshot,
  OrderStatus,
  ProviderAdapter,
} from "../types";

// Sources: services/Project MD/EXTERNAL_ADAPTERS/PAYCREST.md, verified against docs.paycrest.io/openapi-v2.yaml.
export const PAYCREST_BASE_URL = "https://api.paycrest.io";
export const PAYCREST_SIGNATURE_HEADER = "x-paycrest-signature";

// USDC and USDT are 6 decimals on these networks; BNB Smart Chain (18 decimals) is deliberately absent.
const NETWORKS: Partial<Record<Chain, string>> = { base: "base", polygon: "polygon", solana: "solana" };
const CURRENCY_BY_COUNTRY: Partial<Record<Country, FiatCurrency>> = { NG: "NGN", KE: "KES" };

// payment_order.compliance_hold is on-ramp only, so it is left out and alerts if it ever arrives.
const WEBHOOK_EVENTS: ReadonlySet<string> = new Set(
  ["deposited", "pending", "validated", "settling", "settled", "refunding", "refunded", "expired"].map(
    (status) => `payment_order.${status}`,
  ),
);

// /rates returns no quote id or expiry, so the route carries our own short validity.
const QUOTE_TTL_SECONDS = 60;
const LOOKUP_PAGE_SIZE = 100;
const LOOKUP_MAX_PAGES = 5;

export type PaycrestOptions = {
  apiKey: string;
  webhookSecrets: readonly string[];
  deps: AdapterDeps;
  baseUrl?: string;
  maxConcurrent?: number;
};

export function createPaycrestAdapter(options: PaycrestOptions): ProviderAdapter {
  const now = options.deps.now ?? (() => new Date());
  const webhookSecrets = options.webhookSecrets.map((secret) => secret.trim()).filter(Boolean);
  const http = createProviderHttp({
    provider: "paycrest",
    baseUrl: options.baseUrl ?? PAYCREST_BASE_URL,
    maxConcurrent: options.maxConcurrent ?? 8,
    ...(options.deps.fetch ? { fetch: options.deps.fetch } : {}),
    authHeaders: () => ({ "API-Key": options.apiKey }),
  });

  const capabilities: Capabilities = {
    provider: "paycrest",
    custody: "per_order_address",
    corridors: [
      { country: "NG", currency: "NGN", payoutType: "bank" },
      { country: "KE", currency: "KES", payoutType: "bank" },
      { country: "KE", currency: "KES", payoutType: "mobile_money" },
    ],
    sources: Object.keys(NETWORKS).flatMap((chain) => [
      { asset: "USDC" as const, chain: chain as Chain },
      { asset: "USDT" as const, chain: chain as Chain },
    ]),
    limits: {},
  };

  function networkFor(chain: Chain, operation: "quote" | "createOrder"): string {
    const network = NETWORKS[chain];
    if (!network) throw new ProviderError("paycrest", operation, "not_supported", `chain ${chain}`);
    return network;
  }

  function toStatus(status: string, order: JsonObject): OrderStatus | null {
    const text = (key: string) =>
      typeof order[key] === "string" && order[key] !== "" ? (order[key] as string) : undefined;
    switch (status) {
      case "initiated":
        return { status: "awaiting_deposit" };
      case "deposited":
        return { status: "deposit_received" };
      case "pending":
      case "fulfilling":
      case "fulfilled":
        return { status: "processing" };
      case "validated":
      case "settling":
      case "settled": {
        const fiatReference = text("paymentReference");
        return fiatReference ? { status: "paid", fiatReference } : { status: "paid" };
      }
      case "refunding":
        return { status: "refunding" };
      case "refunded": {
        const refundTxHash = text("txHash");
        return refundTxHash ? { status: "refunded", refundTxHash } : { status: "refunded" };
      }
      case "expired":
        return { status: "failed", code: "deposit_expired", retryable: true };
      default:
        return null;
    }
  }

  function unmappable(operation: "getOrder" | "parseWebhook", value: string): ProviderError {
    options.deps.alert({ provider: "paycrest", kind: "unmappable_status", detail: `${operation} ${value}` });
    return new ProviderError("paycrest", operation, "unmappable_status", value);
  }

  function snapshot(order: JsonObject): OrderSnapshot {
    const read = jsonReader("paycrest", "getOrder");
    const status = read.string(order, "status");
    const mapped = toStatus(status, order);
    if (!mapped) throw unmappable("getOrder", status);
    const reference = read.optionalString(order, "reference");
    return { providerOrderId: read.string(order, "id"), ...(reference ? { reference } : {}), ...mapped };
  }

  async function findByReference(reference: string): Promise<OrderSnapshot | null> {
    const read = jsonReader("paycrest", "getOrder");
    for (let page = 1; page <= LOOKUP_MAX_PAGES; page++) {
      const response = await http.request({
        operation: "getOrder",
        method: "GET",
        path: "/v2/sender/orders",
        query: { search: reference, page: String(page), pageSize: String(LOOKUP_PAGE_SIZE) },
      });
      const data = read.object(read.object(response.body, "body").data, "data");
      const orders = read.array(data.orders, "orders").map((order) => read.object(order, "order"));
      const match = orders.find((order) => order.reference === reference);
      if (match) return snapshot(match);
      const total = typeof data.total === "number" ? data.total : Number.POSITIVE_INFINITY;
      if (page * LOOKUP_PAGE_SIZE >= total || orders.length < LOOKUP_PAGE_SIZE) return null;
    }
    // Returning null here would tell reconciliation the order is absent when we simply did not see it.
    throw new ProviderError("paycrest", "getOrder", "unavailable", "reference lookup was not exhaustive");
  }

  return {
    id: "paycrest",

    capabilities: () => capabilities,

    async quote(request) {
      const read = jsonReader("paycrest", "quote");
      if (!CURRENCY_BY_COUNTRY[request.corridor.country]) {
        throw new ProviderError("paycrest", "quote", "not_supported", `country ${request.corridor.country}`);
      }
      if (request.amount.side !== "send") {
        throw new ProviderError(
          "paycrest",
          "quote",
          "not_supported",
          "rates are priced on the token amount only",
        );
      }
      const network = networkFor(request.source.chain, "quote");
      const assetDecimals = ASSET_DECIMALS[request.source.asset];
      const amount = toDecimalString(request.amount.units, assetDecimals);
      const response = await http.request({
        operation: "quote",
        method: "GET",
        path: `/v2/rates/${network}/${request.source.asset}/${amount}/${request.corridor.currency}`,
        query: { side: "sell", limit: "3" },
        acceptStatuses: [404],
      });
      if (response.status === 404) {
        throw new ProviderError("paycrest", "quote", "not_supported", "no provider for this swap");
      }
      const sell = read.object(read.object(read.object(response.body, "body").data, "data").sell, "sell");
      const rate = read.string(sell, "rate");
      const providerIds = read.array(sell.providerIds, "providerIds").filter((id) => typeof id === "string");
      if (providerIds.length === 0) {
        throw new ProviderError("paycrest", "quote", "not_supported", "no provider for this swap");
      }
      let receiveMinorUnits: bigint;
      try {
        receiveMinorUnits = convertAtRate(
          request.amount.units,
          assetDecimals,
          rate,
          FIAT_DECIMALS[request.corridor.currency],
        );
      } catch (error) {
        if (error instanceof InvalidAmountError) throw read.fail("rate is not a decimal");
        throw error;
      }
      return {
        provider: "paycrest",
        providerQuoteId: providerIds.join(","),
        sendUnits: request.amount.units,
        receiveMinorUnits,
        rate,
        fees: [],
        expiresAt: new Date(now().getTime() + QUOTE_TTL_SECONDS * 1000),
      };
    },

    async createOrder(request) {
      const read = jsonReader("paycrest", "createOrder");
      const network = networkFor(request.source.chain, "createOrder");
      const assetDecimals = ASSET_DECIMALS[request.source.asset];
      const providerIds = request.quote.providerQuoteId?.split(",").filter(Boolean) ?? [];
      const response = await http.request({
        operation: "createOrder",
        method: "POST",
        path: "/v2/sender/orders",
        body: {
          amount: toDecimalString(request.quote.sendUnits, assetDecimals),
          rate: request.quote.rate,
          reference: request.payoutId,
          transactionFeePayer: "customer",
          source: {
            type: "crypto",
            currency: request.source.asset,
            network,
            refundAddress: request.refundAddress,
          },
          destination: {
            type: "fiat",
            currency: request.corridor.currency,
            country: request.corridor.country,
            ...(providerIds.length > 0 ? { providerIds } : {}),
            recipient: {
              institution: request.recipient.institutionCode,
              accountIdentifier: request.recipient.accountNumber,
              accountName: request.recipient.accountName,
              memo: request.payoutId,
            },
          },
        },
      });
      const data = read.object(read.object(response.body, "body").data, "data");
      const account = read.object(data.providerAccount, "providerAccount");
      if (read.string(account, "network") !== network) throw read.fail("providerAccount.network differs");
      const memo = read.optionalString(account, "memo");
      return {
        providerOrderId: read.string(data, "id"),
        reference: read.optionalString(data, "reference") ?? request.payoutId,
        funding: {
          kind: "deposit_address",
          chain: request.source.chain,
          asset: request.source.asset,
          address: read.string(account, "receiveAddress"),
          units: read.units(account, "amountToTransfer", assetDecimals),
          validUntil: read.date(account, "validUntil"),
          ...(memo ? { memo } : {}),
        },
      };
    },

    async getOrder(lookup) {
      if ("reference" in lookup) return findByReference(lookup.reference);
      const read = jsonReader("paycrest", "getOrder");
      const response = await http.request({
        operation: "getOrder",
        method: "GET",
        path: `/v2/sender/orders/${encodeURIComponent(lookup.providerOrderId)}`,
        acceptStatuses: [404],
      });
      if (response.status === 404) return null;
      return snapshot(read.object(read.object(response.body, "body").data, "data"));
    },

    async verifyAccount(check) {
      const read = jsonReader("paycrest", "verifyAccount");
      const response = await http.request({
        operation: "verifyAccount",
        method: "POST",
        path: "/v2/verify-account",
        body: { institution: check.institutionCode, accountIdentifier: check.accountNumber },
        acceptStatuses: [400],
      });
      if (response.status === 400) return { found: false };
      const name = read.object(response.body, "body").data;
      if (typeof name !== "string" || name === "") throw read.fail("data is missing");
      return { found: true, accountName: name === "OK" ? null : name };
    },

    async institutions(country) {
      const currency = CURRENCY_BY_COUNTRY[country];
      if (!currency) return [];
      const read = jsonReader("paycrest", "institutions");
      const response = await http.request({
        operation: "institutions",
        method: "GET",
        path: `/v2/institutions/${currency}`,
      });
      return read
        .array(read.object(response.body, "body").data, "data")
        .map((entry) => read.object(entry, "institution"))
        .filter((entry) => entry.type === "bank" || entry.type === "mobile_money")
        .map((entry) => ({
          code: read.string(entry, "code"),
          name: read.string(entry, "name"),
          type: entry.type as "bank" | "mobile_money",
        }));
    },

    parseWebhook(webhook) {
      const read = jsonReader("paycrest", "parseWebhook");
      const valid = verifyHmac({
        algorithm: "sha256",
        encoding: "hex",
        secrets: webhookSecrets,
        payload: webhook.rawBody,
        signature: webhook.headers[PAYCREST_SIGNATURE_HEADER],
      });
      if (!valid) {
        options.deps.alert({
          provider: "paycrest",
          kind: "invalid_signature",
          detail: "webhook signature mismatch",
        });
        throw new ProviderError("paycrest", "parseWebhook", "invalid_signature", "signature mismatch");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(webhook.rawBody);
      } catch {
        throw read.fail("body is not JSON");
      }
      const body = read.object(parsed, "body");
      const event = read.string(body, "event");
      const data = read.object(body.data, "data");
      const order = WEBHOOK_EVENTS.has(event) ? toStatus(event.slice("payment_order.".length), data) : null;
      if (!order) throw unmappable("parseWebhook", event);
      const id = read.string(data, "id");
      const reference = read.optionalString(data, "reference");
      // Paycrest sends no event id; one order emits each event once, so id plus event is the dedupe key.
      return { eventId: `${id}:${event}`, providerOrderId: id, ...(reference ? { reference } : {}), order };
    },

    async health() {
      const response = await http.request({ operation: "health", method: "GET", path: "/health" });
      const body = response.body as { live?: unknown } | null;
      return { healthy: body?.live === "ok" };
    },
  };
}
