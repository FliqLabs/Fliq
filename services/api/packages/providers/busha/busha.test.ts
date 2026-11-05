import { describe, expect, it } from "vitest";
import { hmac } from "../../webhooks/hmac";
import { describeAdapterContract } from "../contract/contract";
import { replayFetch, type RecordedExchange } from "../contract/replay";
import { toDecimalString } from "../money";
import type { CreateOrderRequest, ProviderAlert, ProviderQuote, QuoteRequest } from "../types";
import { BUSHA_SIGNATURE_HEADER, createBushaAdapter, type BushaEnvironment } from "./busha";
import {
  BANKS_NGN,
  HEALTH,
  QUOTE,
  QUOTED_AT,
  RECIPIENT_NGN,
  RESOLVED_ACCOUNT,
  TRANSFER,
  WEBHOOK_DELIVERED,
  WEBHOOK_NOT_DELIVERED,
} from "./busha.fixtures";

const SECRET = "busha-test-secret";
const PAYOUT_ID = "po_01JC2X7Q9Z8K4M3N5P6R7S8T9V";
const RECIPIENT = { institutionCode: "000014", accountNumber: "1234567890", accountName: "John Doe" };

const QUOTE_REQUEST: QuoteRequest = {
  quoteId: "qt_busha",
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

const list = (transfers: unknown[]) => ({
  status: "success",
  message: "Fetched transfers successfully",
  data: transfers,
});

const EXCHANGES: RecordedExchange[] = [
  { method: "POST", path: "/v1/quotes", status: 201, body: QUOTE },
  { method: "GET", path: "/v1/banks?currency=NGN", status: 200, body: BANKS_NGN },
  { method: "POST", path: "/v1/recipients", status: 201, body: RECIPIENT_NGN },
  { method: "POST", path: "/v1/transfers", status: 201, body: TRANSFER },
  {
    method: "GET",
    path: `/v1/transfers?reference=${PAYOUT_ID}`,
    status: 200,
    body: list([{ ...TRANSFER.data, reference: PAYOUT_ID }]),
  },
  { method: "GET", path: "/v1/transfers?reference=po_missing_reference", status: 200, body: list([]) },
  { method: "GET", path: `/v1/transfers/${TRANSFER.data.id}`, status: 200, body: TRANSFER },
  { method: "GET", path: "/v1/transfers/TRF_unknown", status: 404, body: { status: "error" } },
  { method: "POST", path: "/v1/recipients/resolve-bank-account", status: 201, body: RESOLVED_ACCOUNT },
  { method: "GET", path: "/health", status: 200, body: HEALTH },
];

function signed(body: unknown) {
  const rawBody = JSON.stringify(body);
  return { headers: { [BUSHA_SIGNATURE_HEADER]: hmac("sha256", SECRET, rawBody, "base64") }, rawBody };
}

function setup(exchanges: RecordedExchange[] = EXCHANGES, environment: BushaEnvironment = "production") {
  const alerts: ProviderAlert[] = [];
  const replay = replayFetch(exchanges);
  const adapter = createBushaAdapter({
    secretKey: "test-secret-key",
    webhookSecrets: [SECRET],
    environment,
    deps: { fetch: replay.fetch, alert: (alert) => alerts.push(alert) },
  });
  return { adapter, alerts, replay };
}

function withResponse(path: string, method: string, body: unknown, status = 200): RecordedExchange[] {
  return [{ method, path, status, body }, ...EXCHANGES.filter((exchange) => exchange.path !== path)];
}

describeAdapterContract("busha", () => {
  const { adapter, alerts } = setup();
  return {
    adapter,
    alerts,
    quoteRequest: QUOTE_REQUEST,
    orderRequest,
    unknownReference: "po_missing_reference",
    validWebhook: signed(WEBHOOK_DELIVERED),
    expectedWebhookStatus: "paid",
    unmappableWebhook: signed({ ...WEBHOOK_DELIVERED, event: "transfer.completed" }),
    pii: [RECIPIENT.accountNumber, RECIPIENT.accountName],
    quotedAt: QUOTED_AT,
  };
});

describe("busha adapter", () => {
  it("sends the secret key as a bearer token", async () => {
    const { adapter, replay } = setup();
    await adapter.quote(QUOTE_REQUEST);
    expect(replay.calls[0]?.headers.Authorization).toBe("Bearer test-secret-key");
  });

  it("quotes from the source amount and keeps Busha's own fees and expiry", async () => {
    const { adapter, replay } = setup();
    const quote = await adapter.quote(QUOTE_REQUEST);
    expect(JSON.parse(replay.calls[0]?.body ?? "{}")).toEqual({
      source_currency: "USDC",
      target_currency: "NGN",
      source_amount: "100",
      pay_in: { type: "address", network: "SOL" },
    });
    expect(quote.sendUnits).toBe(100_000_000n);
    expect(quote.receiveMinorUnits).toBe(16_887_600n);
    expect(quote.rate).toBe("1690.76");
    expect(quote.fees).toEqual([{ kind: "provider", amount: 20_000n, unit: "NGN" }]);
    expect(quote.expiresAt.toISOString()).toBe("2025-02-20T10:31:19.540Z");
  });

  it("deducts the published payout fee when the quote has no recipient fees yet", async () => {
    const noFees = { ...QUOTE, data: { ...QUOTE.data, fees: [] } };
    const { adapter } = setup(withResponse("/v1/quotes", "POST", noFees, 201));
    const quote = await adapter.quote(QUOTE_REQUEST);
    expect(quote.receiveMinorUnits).toBe(16_887_600n - 10_750n);
    expect(quote.fees).toEqual([{ kind: "provider", amount: 10_750n, unit: "NGN" }]);
  });

  it("asks for the target amount plus the payout fee on a receive-exactly quote", async () => {
    const { adapter, replay } = setup();
    await adapter.quote({ ...QUOTE_REQUEST, amount: { side: "receive", minorUnits: 100_000n } });
    const body = JSON.parse(replay.calls[0]?.body ?? "{}") as {
      target_amount?: string;
      source_amount?: string;
    };
    expect(body.target_amount).toBe(toDecimalString(110_750n, 2));
    expect(body.source_amount).toBeUndefined();
  });

  it("refuses corridors, assets and chains it does not support", async () => {
    const { adapter } = setup();
    const ghana: QuoteRequest = {
      ...QUOTE_REQUEST,
      corridor: { country: "GH", currency: "GHS", payoutType: "bank" },
    };
    const usdt: QuoteRequest = { ...QUOTE_REQUEST, source: { asset: "USDT", chain: "solana" } };
    await expect(adapter.quote(ghana)).rejects.toMatchObject({ kind: "not_supported" });
    await expect(adapter.quote(usdt)).rejects.toMatchObject({ kind: "not_supported" });
    const sandbox = setup(EXCHANGES, "sandbox").adapter;
    await expect(sandbox.quote(QUOTE_REQUEST)).rejects.toMatchObject({ kind: "not_supported" });
  });

  it("uses the sandbox Polygon testnet code", async () => {
    const { adapter, replay } = setup(EXCHANGES, "sandbox");
    await adapter.quote({ ...QUOTE_REQUEST, source: { asset: "USDC", chain: "polygon" } });
    expect(JSON.parse(replay.calls[0]?.body ?? "{}").pay_in).toEqual({ type: "address", network: "AMOY" });
  });

  it("creates a one-time recipient, a firm quote with our reference, then the transfer", async () => {
    const { adapter, replay } = setup();
    const quote = await adapter.quote(QUOTE_REQUEST);
    const order = await adapter.createOrder(orderRequest(quote));
    const calls = replay.calls.slice(1);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /v1/banks?currency=NGN",
      "POST /v1/recipients",
      "POST /v1/quotes",
      "POST /v1/transfers",
    ]);
    expect(JSON.parse(calls[1]?.body ?? "{}")).toMatchObject({
      type: "ngn_bank",
      bank_name: "Access Bank",
      bank_code: "000014",
      one_time: true,
    });
    expect(JSON.parse(calls[2]?.body ?? "{}")).toMatchObject({
      reference: PAYOUT_ID,
      reversal_policy: "conversion_only",
      pay_out: { type: "bank_transfer", recipient_id: RECIPIENT_NGN.data.id },
    });
    expect(JSON.parse(calls[3]?.body ?? "{}")).toEqual({ quote_id: QUOTE.data.id });
    expect(order).toMatchObject({
      providerOrderId: TRANSFER.data.id,
      reference: PAYOUT_ID,
      funding: { kind: "deposit_address", address: TRANSFER.data.pay_in.address, units: 100_000_000n },
    });
  });

  it("keeps the earlier of the quote expiry and the address expiry", async () => {
    const { adapter } = setup();
    const order = await adapter.createOrder(orderRequest(await adapter.quote(QUOTE_REQUEST)));
    expect(order.funding.kind === "deposit_address" && order.funding.validUntil?.toISOString()).toBe(
      "2025-02-20T10:31:19.540Z",
    );
  });

  it("stops before the transfer when the firm quote pays out less than the route", async () => {
    const { adapter, replay } = setup();
    const quote = await adapter.quote(QUOTE_REQUEST);
    const request = orderRequest({ ...quote, receiveMinorUnits: quote.receiveMinorUnits + 1n });
    await expect(adapter.createOrder(request)).rejects.toMatchObject({ kind: "rejected" });
    expect(replay.calls.some((call) => call.path === "/v1/transfers")).toBe(false);
  });

  it("registers M-Pesa recipients with an international phone number", async () => {
    const noFees = { ...QUOTE, data: { ...QUOTE.data, fees: [] } };
    const { adapter, replay } = setup(withResponse("/v1/quotes", "POST", noFees, 201));
    const quote = await adapter.quote(QUOTE_REQUEST);
    await adapter.createOrder({
      ...orderRequest({ ...quote, receiveMinorUnits: 0n }),
      corridor: { country: "KE", currency: "KES", payoutType: "mobile_money" },
      recipient: { institutionCode: "MPESA", accountNumber: "0712345678", accountName: "John Doe" },
    });
    const recipient = replay.calls.find((call) => call.path === "/v1/recipients");
    expect(JSON.parse(recipient?.body ?? "{}")).toMatchObject({
      type: "mpesa_mobile_money",
      currency: "KES",
      country_code: "KE",
      phone_number: "+254712345678",
    });
    expect(replay.calls.some((call) => call.path.startsWith("/v1/banks"))).toBe(false);
  });

  it("does not report a transfer absent when the reference filter returns someone else's", async () => {
    const other = withResponse(`/v1/transfers?reference=${PAYOUT_ID}`, "GET", list([TRANSFER.data]));
    const { adapter } = setup(other);
    await expect(adapter.getOrder({ reference: PAYOUT_ID })).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("returns null for an unknown transfer id", async () => {
    const { adapter } = setup();
    expect(await adapter.getOrder({ providerOrderId: "TRF_unknown" })).toBeNull();
  });

  it("maps a delivered payout to paid with the bank session id", () => {
    const { adapter } = setup();
    const event = adapter.parseWebhook(signed(WEBHOOK_DELIVERED));
    expect(event).toEqual({
      eventId: `${WEBHOOK_DELIVERED.data.id}:transfer.funds_delivered`,
      providerOrderId: WEBHOOK_DELIVERED.data.id,
      order: { status: "paid", fiatReference: WEBHOOK_DELIVERED.data.pay_out.session_id },
    });
  });

  it("maps an undelivered payout to refunding", () => {
    const { adapter } = setup();
    expect(adapter.parseWebhook(signed(WEBHOOK_NOT_DELIVERED)).order).toEqual({ status: "refunding" });
  });

  it("keeps the failure code and only retries insufficient funds", () => {
    const { adapter } = setup();
    const failed = { ...WEBHOOK_NOT_DELIVERED, event: "transfer.failed" };
    expect(adapter.parseWebhook(signed(failed)).order).toEqual({
      status: "failed",
      code: "invalid_account",
      retryable: false,
    });
  });

  it("verifies Nigerian bank accounts and refuses other countries", async () => {
    const { adapter, replay } = setup();
    const result = await adapter.verifyAccount({
      institutionCode: "000013",
      accountNumber: "0123456789",
      country: "NG",
    });
    expect(result).toEqual({ found: true, accountName: "John Doe" });
    expect(JSON.parse(replay.calls[0]?.body ?? "{}")).toMatchObject({
      channel: "bank_transfer",
      currency_id: "NGN",
    });
    await expect(
      adapter.verifyAccount({ institutionCode: "MPESA", accountNumber: "0712345678", country: "KE" }),
    ).rejects.toMatchObject({ kind: "not_supported" });
  });

  it("treats a rejected account lookup as not found", async () => {
    const { adapter } = setup(
      withResponse("/v1/recipients/resolve-bank-account", "POST", { status: "error" }, 400),
    );
    expect(
      await adapter.verifyAccount({ institutionCode: "000013", accountNumber: "0123456789", country: "NG" }),
    ).toEqual({ found: false });
  });

  it("lists Nigerian banks from Busha and M-Pesa for Kenya", async () => {
    const { adapter } = setup();
    expect(await adapter.institutions("NG")).toContainEqual({
      code: "000014",
      name: "Access Bank",
      type: "bank",
    });
    expect(await adapter.institutions("KE")).toEqual([
      { code: "MPESA", name: "M-Pesa", type: "mobile_money" },
    ]);
    expect(await adapter.institutions("GH")).toEqual([]);
  });

  it("reports health from the health endpoint", async () => {
    const { adapter } = setup();
    expect(await adapter.health()).toEqual({ healthy: true });
  });
});
