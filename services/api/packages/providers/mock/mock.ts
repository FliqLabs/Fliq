import { createHash } from "node:crypto";
import { hmac, verifyHmac } from "../../webhooks/hmac";
import { ProviderError } from "../errors";
import { ASSET_DECIMALS, FIAT_DECIMALS, convertAtRate, unitsForTarget } from "../money";
import type {
  AdapterDeps,
  Capabilities,
  CreatedOrder,
  FiatCurrency,
  InboundWebhook,
  OrderSnapshot,
  OrderStatus,
  ProviderAdapter,
  ProviderQuote,
  QuoteRequest,
  WebhookEvent,
} from "../types";

export const MOCK_SIGNATURE_HEADER = "x-mock-signature";

// The amount's cents pick the outcome so every payout state is reachable in tests and `make demo`
// (ARCH §9.3, §19). Any other cents value settles.
export const MOCK_OUTCOME_BY_CENTS = {
  0: "settle",
  1: "fail",
  2: "refund",
  3: "timeout_order_created",
  4: "timeout_order_absent",
} as const;

type Outcome = (typeof MOCK_OUTCOME_BY_CENTS)[keyof typeof MOCK_OUTCOME_BY_CENTS];

export type MockRate = { rateBeforeFees: string; rate: string };

// Copied from spec/fixtures/quote.usdc-ngn-50.json. Other currencies need canonical fixtures first.
export const MOCK_FIXTURE_RATES: Partial<Record<FiatCurrency, MockRate>> = {
  NGN: { rateBeforeFees: "1383.2", rate: "1376.32" },
};

// spec/fixtures: fees { provider: 25000, network: 9400 } on a 50 USDC quote.
const NETWORK_SHARE = { numerator: 9400n, denominator: 34400n };
const QUOTE_TTL_SECONDS = 90;
const SETTLE_SECONDS = 21;
const FIXTURE_BANK_REFERENCE = "000013251029140213";
const FIXTURE_ACCOUNT = { institutionCode: "058", accountNumber: "0123456789", accountName: "DARA OKONKWO" };

type MockOrder = {
  providerOrderId: string;
  reference: string;
  outcome: Outcome;
  path: OrderStatus[];
  step: number;
};

export type MockProviderOptions = {
  deps: AdapterDeps;
  webhookSecret: string;
  rates?: Partial<Record<FiatCurrency, MockRate>>;
};

export type MockControl = {
  deposit(providerOrderId: string): OrderSnapshot;
  advance(providerOrderId: string): OrderSnapshot;
  webhook(providerOrderId: string, eventId: string): InboundWebhook;
};

export function createMockProvider(options: MockProviderOptions): {
  adapter: ProviderAdapter;
  control: MockControl;
} {
  const rates = options.rates ?? MOCK_FIXTURE_RATES;
  const now = options.deps.now ?? (() => new Date());
  const orders = new Map<string, MockOrder>();
  const byReference = new Map<string, string>();

  function find(providerOrderId: string): MockOrder {
    const order = orders.get(providerOrderId);
    if (!order) throw new Error(`mock order ${providerOrderId} does not exist`);
    return order;
  }

  function snapshot(order: MockOrder): OrderSnapshot {
    const status = order.path[order.step] ?? { status: "awaiting_deposit" };
    return { providerOrderId: order.providerOrderId, reference: order.reference, ...status };
  }

  const capabilities: Capabilities = {
    provider: "mock",
    custody: "per_order_address",
    corridors: [
      { country: "NG", currency: "NGN", payoutType: "bank" },
      { country: "KE", currency: "KES", payoutType: "bank" },
      { country: "KE", currency: "KES", payoutType: "mobile_money" },
      { country: "GH", currency: "GHS", payoutType: "bank" },
      { country: "GH", currency: "GHS", payoutType: "mobile_money" },
      { country: "ID", currency: "IDR", payoutType: "bank" },
      { country: "ID", currency: "IDR", payoutType: "mobile_money" },
      { country: "PH", currency: "PHP", payoutType: "bank" },
      { country: "PH", currency: "PHP", payoutType: "mobile_money" },
    ],
    sources: [
      { asset: "USDC", chain: "simulated" },
      { asset: "USDT", chain: "simulated" },
    ],
    limits: {},
  };

  const adapter: ProviderAdapter = {
    id: "mock",

    capabilities: () => capabilities,

    async quote(request: QuoteRequest): Promise<ProviderQuote> {
      const rate = rates[request.corridor.currency];
      if (!rate)
        throw new ProviderError("mock", "quote", "not_supported", `no rate for ${request.corridor.currency}`);
      const assetDecimals = ASSET_DECIMALS[request.source.asset];
      const fiatDecimals = FIAT_DECIMALS[request.corridor.currency];
      const sendUnits =
        request.amount.side === "send"
          ? request.amount.units
          : unitsForTarget(request.amount.minorUnits, assetDecimals, rate.rate, fiatDecimals);
      const receiveMinorUnits = convertAtRate(sendUnits, assetDecimals, rate.rate, fiatDecimals);
      const totalFee =
        convertAtRate(sendUnits, assetDecimals, rate.rateBeforeFees, fiatDecimals) - receiveMinorUnits;
      const networkFee = (totalFee * NETWORK_SHARE.numerator) / NETWORK_SHARE.denominator;
      return {
        provider: "mock",
        providerQuoteId: `mq_${digest(`${request.corridor.currency}:${sendUnits}`)}`,
        sendUnits,
        receiveMinorUnits,
        rate: rate.rate,
        fees: [
          { kind: "provider", amount: totalFee - networkFee, unit: request.corridor.currency },
          { kind: "network", amount: networkFee, unit: request.corridor.currency },
        ],
        estimatedSettleSeconds: SETTLE_SECONDS,
        expiresAt: new Date(now().getTime() + QUOTE_TTL_SECONDS * 1000),
      };
    },

    async createOrder(request): Promise<CreatedOrder> {
      const existing = byReference.get(request.payoutId);
      if (existing) return created(find(existing), request.quote.sendUnits, request.source.asset);
      const outcome = outcomeFor(request.quote.sendUnits, ASSET_DECIMALS[request.source.asset]);
      if (outcome === "timeout_order_absent") {
        throw new ProviderError("mock", "createOrder", "timeout", "simulated timeout, order not created");
      }
      const providerOrderId = `mo_${digest(request.payoutId)}`;
      const order: MockOrder = {
        providerOrderId,
        reference: request.payoutId,
        outcome,
        path: pathFor(outcome, providerOrderId),
        step: 0,
      };
      orders.set(order.providerOrderId, order);
      byReference.set(order.reference, order.providerOrderId);
      if (outcome === "timeout_order_created") {
        throw new ProviderError("mock", "createOrder", "timeout", "simulated timeout, order exists");
      }
      return created(order, request.quote.sendUnits, request.source.asset);
    },

    async getOrder(lookup) {
      const id = "reference" in lookup ? byReference.get(lookup.reference) : lookup.providerOrderId;
      const order = id === undefined ? undefined : orders.get(id);
      return order ? snapshot(order) : null;
    },

    async verifyAccount(check) {
      const matches =
        check.country === "NG" &&
        check.institutionCode === FIXTURE_ACCOUNT.institutionCode &&
        check.accountNumber === FIXTURE_ACCOUNT.accountNumber;
      return matches ? { found: true, accountName: FIXTURE_ACCOUNT.accountName } : { found: false };
    },

    async institutions(country) {
      return country === "NG"
        ? [{ code: FIXTURE_ACCOUNT.institutionCode, name: "GTBank", type: "bank" }]
        : [];
    },

    parseWebhook(webhook): WebhookEvent {
      const valid = verifyHmac({
        algorithm: "sha256",
        encoding: "hex",
        secrets: [options.webhookSecret],
        payload: webhook.rawBody,
        signature: webhook.headers[MOCK_SIGNATURE_HEADER],
      });
      if (!valid) {
        options.deps.alert({
          provider: "mock",
          kind: "invalid_signature",
          detail: "webhook signature mismatch",
        });
        throw new ProviderError("mock", "parseWebhook", "invalid_signature", "signature mismatch");
      }
      const event = parseMockEvent(webhook.rawBody);
      const order = toOrderStatus(event);
      if (!order) {
        options.deps.alert({ provider: "mock", kind: "unmappable_status", detail: `status ${event.status}` });
        throw new ProviderError("mock", "parseWebhook", "unmappable_status", `status ${event.status}`);
      }
      return { eventId: event.event_id, providerOrderId: event.order_id, reference: event.reference, order };
    },

    async health() {
      return { healthy: true };
    },
  };

  const control: MockControl = {
    deposit(providerOrderId) {
      const order = find(providerOrderId);
      if (order.step === 0) order.step = 1;
      return snapshot(order);
    },
    advance(providerOrderId) {
      const order = find(providerOrderId);
      if (order.step === 0) throw new Error("mock order has no deposit yet");
      order.step = Math.min(order.step + 1, order.path.length - 1);
      return snapshot(order);
    },
    webhook(providerOrderId, eventId) {
      const current = snapshot(find(providerOrderId));
      const rawBody = JSON.stringify(toMockEvent(eventId, current));
      return {
        headers: { [MOCK_SIGNATURE_HEADER]: hmac("sha256", options.webhookSecret, rawBody, "hex") },
        rawBody,
      };
    },
  };

  return { adapter, control };
}

function created(order: MockOrder, units: bigint, asset: "USDC" | "USDT"): CreatedOrder {
  return {
    providerOrderId: order.providerOrderId,
    reference: order.reference,
    funding: {
      kind: "deposit_address",
      chain: "simulated",
      asset,
      address: `mock:${order.providerOrderId}`,
      units,
    },
  };
}

function outcomeFor(sendUnits: bigint, assetDecimals: number): Outcome {
  const cents = Number((sendUnits / 10n ** BigInt(assetDecimals - 2)) % 100n);
  return MOCK_OUTCOME_BY_CENTS[cents as keyof typeof MOCK_OUTCOME_BY_CENTS] ?? "settle";
}

function pathFor(outcome: Outcome, providerOrderId: string): OrderStatus[] {
  const start: OrderStatus[] = [
    { status: "awaiting_deposit" },
    { status: "deposit_received" },
    { status: "processing" },
  ];
  if (outcome === "fail") return [...start, { status: "failed", code: "payout_rejected", retryable: false }];
  if (outcome === "refund") {
    const refundTxHash = `mock_refund_${digest(providerOrderId)}`;
    return [...start, { status: "refunding" }, { status: "refunded", refundTxHash }];
  }
  return [...start, { status: "paid", fiatReference: FIXTURE_BANK_REFERENCE }];
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

type MockEvent = {
  event_id: string;
  order_id: string;
  reference: string;
  status: string;
  fiat_reference?: string;
  refund_tx_hash?: string;
  failure_code?: string;
};

function toMockEvent(eventId: string, snapshot: OrderSnapshot): MockEvent {
  const base = { event_id: eventId, order_id: snapshot.providerOrderId, reference: snapshot.reference ?? "" };
  if (snapshot.status === "paid")
    return { ...base, status: "paid", fiat_reference: snapshot.fiatReference ?? "" };
  if (snapshot.status === "refunded")
    return { ...base, status: "refunded", refund_tx_hash: snapshot.refundTxHash ?? "" };
  if (snapshot.status === "failed") return { ...base, status: "failed", failure_code: snapshot.code };
  return { ...base, status: snapshot.status };
}

function parseMockEvent(rawBody: string): MockEvent {
  const parsed: unknown = JSON.parse(rawBody);
  if (typeof parsed !== "object" || parsed === null) {
    throw new ProviderError("mock", "parseWebhook", "invalid_response", "body is not an object");
  }
  const event = parsed as Record<string, unknown>;
  for (const field of ["event_id", "order_id", "reference", "status"]) {
    if (typeof event[field] !== "string") {
      throw new ProviderError("mock", "parseWebhook", "invalid_response", `missing ${field}`);
    }
  }
  return event as MockEvent;
}

function toOrderStatus(event: MockEvent): OrderStatus | null {
  switch (event.status) {
    case "awaiting_deposit":
    case "deposit_received":
    case "processing":
    case "refunding":
      return { status: event.status };
    case "paid":
      return { status: "paid", ...(event.fiat_reference ? { fiatReference: event.fiat_reference } : {}) };
    case "refunded":
      return { status: "refunded", ...(event.refund_tx_hash ? { refundTxHash: event.refund_tx_hash } : {}) };
    case "failed":
      return { status: "failed", code: event.failure_code ?? "unknown", retryable: false };
    default:
      return null;
  }
}
