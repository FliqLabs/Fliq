import { describe, expect, it } from "vitest";
import { hmac } from "../../webhooks/hmac";
import { describeAdapterContract } from "../contract/contract";
import { replayFetch, type RecordedExchange } from "../contract/replay";
import type { CreateOrderRequest, ProviderAlert, ProviderQuote, QuoteRequest } from "../types";
import { PAYCREST_SIGNATURE_HEADER, createPaycrestAdapter } from "./paycrest";
import {
  CREATE_ORDER,
  HEALTH,
  INSTITUTIONS_KES,
  ORDER,
  RATES_SELL,
  VERIFY_NAME,
  VERIFY_OK,
  WEBHOOK_SETTLED_V2,
} from "./paycrest.fixtures";

const SECRET = "paycrest-test-secret";
const PAYOUT_ID = "invoice-123";
const RECIPIENT = { institutionCode: "GTBINGLA", accountNumber: "1234567890", accountName: "John Doe" };

const QUOTE_REQUEST: QuoteRequest = {
  quoteId: "qt_paycrest",
  corridor: { country: "NG", currency: "NGN", payoutType: "bank" },
  source: { asset: "USDC", chain: "solana" },
  amount: { side: "send", units: 100_000_000n },
};

function orderRequest(quote: ProviderQuote): CreateOrderRequest {
  return {
    payoutId: PAYOUT_ID,
    quote,
    corridor: QUOTE_REQUEST.corridor,
    source: QUOTE_REQUEST.source,
    recipient: RECIPIENT,
    refundAddress: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T",
  };
}

const list = (orders: unknown[], total = orders.length) => ({
  status: "success",
  data: { total, page: 1, pageSize: 100, orders },
});

const EXCHANGES: RecordedExchange[] = [
  { method: "GET", path: "/v2/rates/solana/USDC/100/NGN?side=sell&limit=3", status: 200, body: RATES_SELL },
  { method: "POST", path: "/v2/sender/orders", status: 201, body: CREATE_ORDER },
  {
    method: "GET",
    path: `/v2/sender/orders/${ORDER.id}`,
    status: 200,
    body: { status: "success", data: ORDER },
  },
  { method: "GET", path: "/v2/sender/orders/unknown-id", status: 404, body: { status: "error", data: null } },
  {
    method: "GET",
    path: `/v2/sender/orders?search=${PAYOUT_ID}&page=1&pageSize=100`,
    status: 200,
    body: list([ORDER]),
  },
  {
    method: "GET",
    path: "/v2/sender/orders?search=po_missing&page=1&pageSize=100",
    status: 200,
    body: list([]),
  },
  { method: "POST", path: "/v2/verify-account", status: 200, body: VERIFY_NAME },
  { method: "GET", path: "/v2/institutions/KES", status: 200, body: INSTITUTIONS_KES },
  { method: "GET", path: "/health", status: 200, body: HEALTH },
];

function signed(body: unknown) {
  const rawBody = JSON.stringify(body);
  return { headers: { [PAYCREST_SIGNATURE_HEADER]: hmac("sha256", SECRET, rawBody, "hex") }, rawBody };
}

function setup(exchanges: RecordedExchange[] = EXCHANGES) {
  const alerts: ProviderAlert[] = [];
  const replay = replayFetch(exchanges);
  const adapter = createPaycrestAdapter({
    apiKey: "test-api-key",
    webhookSecrets: [SECRET],
    deps: { fetch: replay.fetch, alert: (alert) => alerts.push(alert) },
  });
  return { adapter, alerts, replay };
}

describeAdapterContract("paycrest", () => {
  const { adapter, alerts } = setup();
  return {
    adapter,
    alerts,
    quoteRequest: QUOTE_REQUEST,
    orderRequest,
    unknownReference: "po_missing",
    validWebhook: signed(WEBHOOK_SETTLED_V2),
    expectedWebhookStatus: "paid",
    unmappableWebhook: signed({ ...WEBHOOK_SETTLED_V2, event: "payment_order.compliance_hold" }),
    pii: [RECIPIENT.accountNumber, RECIPIENT.accountName],
  };
});

describe("paycrest adapter", () => {
  it("sends the API key header on every call", async () => {
    const { adapter, replay } = setup();
    await adapter.quote(QUOTE_REQUEST);
    expect(replay.calls[0]?.headers["API-Key"]).toBe("test-api-key");
  });

  it("prices the token amount at the sell rate without floats", async () => {
    const { adapter } = setup();
    const quote = await adapter.quote(QUOTE_REQUEST);
    expect(quote.receiveMinorUnits).toBe(15_005_000n);
    expect(quote.rate).toBe("1500.50");
    expect(quote.providerQuoteId).toBe("AbCdEfGh,IjKlMnOp,QrStUvWx");
  });

  it("refuses receive-exactly quotes and chains it cannot take", async () => {
    const { adapter } = setup();
    await expect(
      adapter.quote({ ...QUOTE_REQUEST, amount: { side: "receive", minorUnits: 100n } }),
    ).rejects.toMatchObject({ kind: "not_supported" });
    await expect(
      adapter.quote({ ...QUOTE_REQUEST, source: { asset: "USDC", chain: "bnb" } }),
    ).rejects.toMatchObject({ kind: "not_supported" });
  });

  it("creates the order with our payout id as reference and the quoted provider queue", async () => {
    const { adapter, replay } = setup();
    const order = await adapter.createOrder(orderRequest(await adapter.quote(QUOTE_REQUEST)));
    const sent = JSON.parse(replay.calls[1]?.body ?? "{}");
    expect(sent).toMatchObject({
      amount: "100",
      rate: "1500.50",
      reference: PAYOUT_ID,
      transactionFeePayer: "customer",
      source: { type: "crypto", currency: "USDC", network: "solana" },
      destination: {
        type: "fiat",
        currency: "NGN",
        providerIds: ["AbCdEfGh", "IjKlMnOp", "QrStUvWx"],
        recipient: { institution: "GTBINGLA", accountIdentifier: "1234567890", memo: PAYOUT_ID },
      },
    });
    expect(order.funding).toEqual({
      kind: "deposit_address",
      chain: "solana",
      asset: "USDC",
      address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      units: 105_000_000n,
      validUntil: new Date("2026-09-24T05:45:00Z"),
    });
  });

  it("does not retry a failed create", async () => {
    const { adapter, replay } = setup([
      EXCHANGES[0]!,
      { method: "POST", path: "/v2/sender/orders", status: 503, body: { status: "error" } },
    ]);
    const quote = await adapter.quote(QUOTE_REQUEST);
    await expect(adapter.createOrder(orderRequest(quote))).rejects.toMatchObject({ kind: "unavailable" });
    expect(replay.calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("returns null for an unknown order id", async () => {
    const { adapter } = setup();
    expect(await adapter.getOrder({ providerOrderId: "unknown-id" })).toBeNull();
  });

  it("never reports an order absent when the reference scan was not exhaustive", async () => {
    const other = { ...ORDER, reference: "someone-else" };
    const pages: RecordedExchange[] = [1, 2, 3, 4, 5].map((page) => ({
      method: "GET",
      path: `/v2/sender/orders?search=po_far&page=${page}&pageSize=100`,
      status: 200,
      body: { status: "success", data: { total: 900, page, pageSize: 100, orders: Array(100).fill(other) } },
    }));
    const { adapter } = setup(pages);
    await expect(adapter.getOrder({ reference: "po_far" })).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("maps every documented order status", async () => {
    const expectations: Record<string, string> = {
      initiated: "awaiting_deposit",
      deposited: "deposit_received",
      pending: "processing",
      fulfilling: "processing",
      fulfilled: "processing",
      validated: "paid",
      settling: "paid",
      settled: "paid",
      refunding: "refunding",
      refunded: "refunded",
      expired: "failed",
    };
    for (const [status, normalized] of Object.entries(expectations)) {
      const { adapter } = setup([
        {
          method: "GET",
          path: `/v2/sender/orders/${ORDER.id}`,
          status: 200,
          body: { status: "success", data: { ...ORDER, status } },
        },
      ]);
      expect((await adapter.getOrder({ providerOrderId: ORDER.id }))?.status).toBe(normalized);
    }
  });

  it("alerts instead of guessing on a cancelled order", async () => {
    const { adapter, alerts } = setup([
      {
        method: "GET",
        path: `/v2/sender/orders/${ORDER.id}`,
        status: 200,
        body: { status: "success", data: { ...ORDER, status: "cancelled" } },
      },
    ]);
    await expect(adapter.getOrder({ providerOrderId: ORDER.id })).rejects.toMatchObject({
      kind: "unmappable_status",
    });
    expect(alerts).toHaveLength(1);
  });

  it("carries the fiat receipt from a settled webhook", () => {
    const { adapter } = setup();
    const event = adapter.parseWebhook(signed(WEBHOOK_SETTLED_V2));
    expect(event).toEqual({
      eventId: "550e8400-e29b-41d4-a716-446655440000:payment_order.settled",
      providerOrderId: "550e8400-e29b-41d4-a716-446655440000",
      reference: "payment-123",
      order: { status: "paid", fiatReference: "100004261019223045000123456789" },
    });
  });

  it("accepts the previous webhook secret during rotation", () => {
    const alerts: ProviderAlert[] = [];
    const adapter = createPaycrestAdapter({
      apiKey: "k",
      webhookSecrets: ["new-secret", ` ${SECRET} `],
      deps: { alert: (alert) => alerts.push(alert) },
    });
    expect(adapter.parseWebhook(signed(WEBHOOK_SETTLED_V2)).order.status).toBe("paid");
  });

  it("verifies an account name, a nameless OK and a rejection", async () => {
    expect(
      await setup().adapter.verifyAccount({
        country: "NG",
        institutionCode: "GTBINGLA",
        accountNumber: "0123456789",
      }),
    ).toEqual({ found: true, accountName: "JOHN DOE" });
    const ok = setup([{ method: "POST", path: "/v2/verify-account", status: 200, body: VERIFY_OK }]);
    expect(
      await ok.adapter.verifyAccount({
        country: "KE",
        institutionCode: "SAFAKEPC",
        accountNumber: "0712345678",
      }),
    ).toEqual({ found: true, accountName: null });
    const rejected = setup([
      { method: "POST", path: "/v2/verify-account", status: 400, body: { status: "error" } },
    ]);
    expect(
      await rejected.adapter.verifyAccount({
        country: "NG",
        institutionCode: "GTBINGLA",
        accountNumber: "1",
      }),
    ).toEqual({ found: false });
  });

  it("lists institutions by the country's currency", async () => {
    const { adapter } = setup();
    expect(await adapter.institutions("KE")).toEqual([
      { code: "EQBLKENA", name: "Equity Bank", type: "bank" },
      { code: "AIRTKEPC", name: "AIRTEL", type: "mobile_money" },
      { code: "SAFAKEPC", name: "M-PESA", type: "mobile_money" },
    ]);
    expect(await adapter.institutions("GH")).toEqual([]);
  });

  it("reports health from the public health endpoint", async () => {
    expect(await setup().adapter.health()).toEqual({ healthy: true });
  });
});
