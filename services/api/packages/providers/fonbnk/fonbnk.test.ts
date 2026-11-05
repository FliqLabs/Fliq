import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { describeAdapterContract } from "../contract/contract";
import { replayFetch, type RecordedExchange } from "../contract/replay";
import type { CreateOrderRequest, ProviderAlert, ProviderQuote, QuoteRequest } from "../types";
import { FONBNK_SIGNATURE_HEADER, createFonbnkAdapter } from "./fonbnk";
import {
  AMOUNT_BELOW_MINIMUM,
  CONFIRM_HASH,
  CREATE_ORDER,
  CURRENCIES,
  ORDER_NOT_AVAILABLE,
  QUOTE,
  QUOTED_AT,
  WEBHOOK_PAYOUT_SUCCESSFUL,
} from "./fonbnk.fixtures";

const SIGNING_SECRET = Buffer.from("fonbnk-test-signing-secret").toString("base64");
const WEBHOOK_SECRET = "fonbnk-test-webhook-secret";
const PAYOUT_ID = "po_01JC2X7Q9Z8K4M3N5P6R7S8T9V";
const ORDER_ID = CREATE_ORDER.order._id;
const RECIPIENT = {
  institutionCode: "1",
  accountNumber: "1234567890",
  accountName: "Ada Obi",
  phone: "08012345678",
};
const END_USER = { email: "payouts@fliq.example", ip: "203.0.113.10" };

const QUOTE_REQUEST: QuoteRequest = {
  quoteId: "qt_fonbnk",
  corridor: { country: "NG", currency: "NGN", payoutType: "bank" },
  source: { asset: "USDT", chain: "polygon" },
  amount: { side: "receive", minorUnits: 3_000_000n },
};

function orderRequest(
  quote: ProviderQuote,
  recipient: CreateOrderRequest["recipient"] = RECIPIENT,
): CreateOrderRequest {
  return {
    payoutId: PAYOUT_ID,
    quote,
    corridor: QUOTE_REQUEST.corridor,
    source: QUOTE_REQUEST.source,
    recipient,
    refundAddress: "0x5b7ae3c6c87f4a3f94b35c77233b13191ebfad20",
  };
}

const orderWith = (changes: Record<string, unknown>) => ({ ...CREATE_ORDER.order, ...changes });

const EXCHANGES: RecordedExchange[] = [
  { method: "POST", path: "/api/v2/quote", status: 200, body: QUOTE },
  { method: "POST", path: "/api/v2/order", status: 200, body: CREATE_ORDER },
  {
    method: "GET",
    path: `/api/v2/order?orderParams=${PAYOUT_ID}`,
    status: 200,
    body: orderWith({ merchantOrderParams: PAYOUT_ID }),
  },
  { method: "GET", path: `/api/v2/order?orderId=${ORDER_ID}`, status: 200, body: CREATE_ORDER.order },
  {
    method: "GET",
    path: "/api/v2/order?orderParams=po_missing_reference",
    status: 404,
    body: ORDER_NOT_AVAILABLE,
  },
  { method: "GET", path: "/api/v2/currencies", status: 200, body: CURRENCIES },
  {
    method: "POST",
    path: "/api/v2/order/confirm",
    status: 200,
    body: orderWith({ status: "deposit_validating" }),
  },
  {
    method: "POST",
    path: "/api/v2/order/cancel",
    status: 200,
    body: orderWith({ status: "deposit_canceled" }),
  },
];

function webhookSignature(rawBody: string, secret: string): string {
  const secretHash = createHash("sha256").update(secret, "utf8").digest("hex");
  return createHash("sha256").update(rawBody).update(secretHash).digest("hex");
}

function signed(body: unknown, secret = WEBHOOK_SECRET) {
  const rawBody = JSON.stringify(body);
  return { headers: { [FONBNK_SIGNATURE_HEADER]: webhookSignature(rawBody, secret) }, rawBody };
}

const withStatus = (status: string) => ({
  ...WEBHOOK_PAYOUT_SUCCESSFUL,
  data: { ...WEBHOOK_PAYOUT_SUCCESSFUL.data, order: { ...WEBHOOK_PAYOUT_SUCCESSFUL.data.order, status } },
});

function setup(exchanges: RecordedExchange[] = EXCHANGES, webhookSecrets = [WEBHOOK_SECRET]) {
  const alerts: ProviderAlert[] = [];
  const replay = replayFetch(exchanges);
  const adapter = createFonbnkAdapter({
    clientId: "test-client-id",
    signatureSecret: SIGNING_SECRET,
    webhookSecrets,
    environment: "sandbox",
    endUser: END_USER,
    deps: { fetch: replay.fetch, alert: (alert) => alerts.push(alert) },
  });
  return { adapter, alerts, replay };
}

function withResponse(method: string, path: string, body: unknown, status = 200): RecordedExchange[] {
  return [{ method, path, status, body }, ...EXCHANGES.filter((exchange) => exchange.path !== path)];
}

const bodyOf = (call: { body: string } | undefined) => JSON.parse(call?.body ?? "{}");

describeAdapterContract("fonbnk", () => {
  const { adapter, alerts } = setup();
  return {
    adapter,
    alerts,
    quoteRequest: QUOTE_REQUEST,
    orderRequest: (quote) => orderRequest(quote),
    unknownReference: "po_missing_reference",
    validWebhook: signed(WEBHOOK_PAYOUT_SUCCESSFUL),
    expectedWebhookStatus: "paid",
    unmappableWebhook: signed(withStatus("payout_teleported")),
    pii: [RECIPIENT.accountNumber, RECIPIENT.accountName, RECIPIENT.phone, "2348012345678"],
    quotedAt: QUOTED_AT,
  };
});

describe("fonbnk adapter", () => {
  it("signs the timestamp and the exact path and query with the decoded secret", async () => {
    const { adapter, replay } = setup();
    await adapter.getOrder({ reference: PAYOUT_ID });
    const headers = replay.calls[0]?.headers ?? {};
    expect(headers["x-client-id"]).toBe("test-client-id");
    expect(headers["x-timestamp"]).toMatch(/^\d{13}$/);
    const expected = createHmac("sha256", Buffer.from(SIGNING_SECRET, "base64"))
      .update(`${headers["x-timestamp"]}:/api/v2/order?orderParams=${PAYOUT_ID}`)
      .digest("base64");
    expect(headers["x-signature"]).toBe(expected);
  });

  it("quotes a receive amount in whole fiat and keeps Fonbnk's own amounts, fees and expiry", async () => {
    const { adapter, replay } = setup();
    const quote = await adapter.quote(QUOTE_REQUEST);
    expect(bodyOf(replay.calls[0])).toEqual({
      deposit: { paymentChannel: "crypto", currencyType: "crypto", currencyCode: "POLYGON_USDT" },
      payout: {
        paymentChannel: "bank",
        currencyType: "fiat",
        currencyCode: "NGN",
        countryIsoCode: "NG",
        amount: 30000,
      },
    });
    expect(quote).toEqual({
      provider: "fonbnk",
      providerQuoteId: QUOTE.quoteId,
      sendUnits: 21_272_315n,
      receiveMinorUnits: 3_000_000n,
      rate: "1461.43",
      fees: [
        { kind: "provider", amount: 77_720n, unit: "NGN" },
        { kind: "provider", amount: 31_088n, unit: "NGN" },
      ],
      expiresAt: new Date(QUOTE.quoteExpiresAt),
    });
  });

  it("quotes a send amount on the deposit leg and rounds a fractional fiat target up", async () => {
    const { adapter, replay } = setup();
    await adapter.quote({ ...QUOTE_REQUEST, amount: { side: "send", units: 21_272_315n } });
    await adapter.quote({ ...QUOTE_REQUEST, amount: { side: "receive", minorUnits: 2_999_950n } });
    expect(bodyOf(replay.calls[0]).deposit.amount).toBe(21.272315);
    expect(bodyOf(replay.calls[0]).payout.amount).toBeUndefined();
    expect(bodyOf(replay.calls[1]).payout.amount).toBe(30000);
  });

  it("sends the M-Pesa carrier and refuses corridors and assets it does not serve", async () => {
    const { adapter, replay } = setup();
    await adapter.quote({
      ...QUOTE_REQUEST,
      corridor: { country: "KE", currency: "KES", payoutType: "mobile_money" },
    });
    expect(bodyOf(replay.calls[0]).payout.carrierCode).toBe("ke_safaricom");
    await expect(
      adapter.quote({
        ...QUOTE_REQUEST,
        corridor: { country: "GH", currency: "GHS", payoutType: "mobile_money" },
      }),
    ).rejects.toMatchObject({ kind: "not_supported" });
    await expect(
      adapter.quote({ ...QUOTE_REQUEST, source: { asset: "USDT", chain: "base" } }),
    ).rejects.toMatchObject({
      kind: "not_supported",
    });
  });

  it("treats a missing route as retryable and an amount out of range as a rejection", async () => {
    const unavailable = setup(
      withResponse("POST", "/api/v2/quote", { errorCode: "ROUTE_NOT_AVAILABLE" }, 404),
    );
    await expect(unavailable.adapter.quote(QUOTE_REQUEST)).rejects.toMatchObject({ kind: "unavailable" });
    const belowMinimum = setup(withResponse("POST", "/api/v2/quote", AMOUNT_BELOW_MINIMUM, 404));
    await expect(belowMinimum.adapter.quote(QUOTE_REQUEST)).rejects.toMatchObject({ kind: "rejected" });
  });

  it("creates the order with our payout id, the locked quote and the recipient fields", async () => {
    const { adapter, replay } = setup();
    const quote = await adapter.quote(QUOTE_REQUEST);
    const order = await adapter.createOrder(orderRequest(quote));
    expect(bodyOf(replay.calls[1])).toEqual({
      quoteId: QUOTE.quoteId,
      userEmail: END_USER.email,
      userIp: END_USER.ip,
      userCountryIsoCode: "NG",
      deposit: {
        paymentChannel: "crypto",
        currencyType: "crypto",
        currencyCode: "POLYGON_USDT",
        amount: 21.272315,
      },
      payout: { paymentChannel: "bank", currencyType: "fiat", currencyCode: "NGN", countryIsoCode: "NG" },
      fieldsToCreateOrder: { bankCode: "1", bankAccountNumber: "1234567890", phoneNumber: "2348012345678" },
      orderParams: PAYOUT_ID,
    });
    expect(order).toEqual({
      providerOrderId: ORDER_ID,
      reference: PAYOUT_ID,
      funding: {
        kind: "deposit_address",
        chain: "polygon",
        asset: "USDT",
        address: "0xdc9cbad0c43f912a66cd44cd22a15c04368e659f",
        units: 21_272_315n,
        validUntil: new Date(CREATE_ORDER.order.expiresAt),
      },
    });
  });

  it("refuses a Nigerian bank payout without the recipient's phone before calling Fonbnk", async () => {
    const { adapter, replay } = setup();
    const quote = await adapter.quote(QUOTE_REQUEST);
    const { phone: _phone, ...noPhone } = RECIPIENT;
    await expect(adapter.createOrder(orderRequest(quote, noPhone))).rejects.toMatchObject({
      kind: "rejected",
    });
    expect(replay.calls.map((call) => call.path)).toEqual(["/api/v2/quote"]);
  });

  it("cancels and refuses an order Fonbnk did not price at our quote", async () => {
    const { adapter, replay } = setup(
      withResponse("POST", "/api/v2/order", { ...CREATE_ORDER, quoteUsed: false }),
    );
    const quote = await adapter.quote(QUOTE_REQUEST);
    await expect(adapter.createOrder(orderRequest(quote))).rejects.toMatchObject({ kind: "rejected" });
    expect(replay.calls.at(-1)).toMatchObject({ method: "POST", path: "/api/v2/order/cancel" });
    expect(bodyOf(replay.calls.at(-1))).toEqual({ orderId: ORDER_ID });
  });

  it("confirms the deposit with our transaction hash", async () => {
    const { adapter, replay } = setup();
    const confirmed = await adapter.confirmDeposit(ORDER_ID, CONFIRM_HASH);
    expect(bodyOf(replay.calls[0])).toEqual({
      orderId: ORDER_ID,
      fieldsToConfirmOrder: { blockchainTransactionHash: CONFIRM_HASH },
    });
    expect(confirmed).toEqual({ providerOrderId: ORDER_ID, status: "deposit_received" });
  });

  it("maps statuses that are not final to non-final ones and reads the refund hash", async () => {
    const statusOf = async (order: Record<string, unknown>) => {
      const { adapter } = setup(withResponse("GET", `/api/v2/order?orderId=${ORDER_ID}`, orderWith(order)));
      return adapter.getOrder({ providerOrderId: ORDER_ID });
    };
    expect(await statusOf({ status: "payout_failed" })).toMatchObject({ status: "processing" });
    expect(await statusOf({ status: "refund_failed" })).toMatchObject({ status: "refunding" });
    expect(await statusOf({ status: "deposit_expired" })).toMatchObject({
      status: "failed",
      code: "deposit_expired",
      retryable: true,
    });
    expect(await statusOf({ status: "deposit_invalid" })).toMatchObject({
      status: "failed",
      retryable: false,
    });
    expect(
      await statusOf({
        status: "refund_successful",
        refund: { transaction: { meta: { transactionHash: CONFIRM_HASH } } },
      }),
    ).toMatchObject({ status: "refunded", refundTxHash: CONFIRM_HASH });
  });

  it("keys webhook events on order, status and update time, and accepts the previous secret", () => {
    const { adapter } = setup(EXCHANGES, [WEBHOOK_SECRET, "previous-secret"]);
    const event = adapter.parseWebhook(signed(WEBHOOK_PAYOUT_SUCCESSFUL, "previous-secret"));
    const order = WEBHOOK_PAYOUT_SUCCESSFUL.data.order;
    expect(event).toEqual({
      eventId: `${order._id}:payout_successful:${order.updatedAt}`,
      providerOrderId: order._id,
      reference: order.merchantOrderParams,
      order: { status: "paid" },
    });
  });

  it("reads bank codes from a quote and lists M-Pesa for Kenya", async () => {
    const { adapter } = setup();
    expect(await adapter.institutions("NG")).toEqual([
      { code: "1", name: "Sandbox Bank", type: "bank" },
      { code: "2", name: "Sandbox Bank 2", type: "bank" },
      { code: "3", name: "Sandbox Bank 3", type: "bank" },
    ]);
    expect((await adapter.institutions("KE"))[0]).toEqual({
      code: "ke_safaricom",
      name: "M-PESA",
      type: "mobile_money",
    });
    expect(await adapter.institutions("GH")).toEqual([]);
  });

  it("has no account lookup and reports health from the currency list", async () => {
    const { adapter } = setup();
    await expect(
      adapter.verifyAccount({ institutionCode: "1", accountNumber: "1234567890", country: "NG" }),
    ).rejects.toMatchObject({ kind: "not_supported" });
    expect(await adapter.health()).toEqual({ healthy: true });
  });
});
