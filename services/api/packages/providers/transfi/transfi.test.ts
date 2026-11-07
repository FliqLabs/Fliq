import { describe, expect, it } from "vitest";
import { hmac } from "../../webhooks/hmac";
import { describeAdapterContract } from "../contract/contract";
import { replayFetch, type RecordedExchange } from "../contract/replay";
import type { CreateOrderRequest, ProviderAlert, ProviderQuote, QuoteRequest } from "../types";
import { TRANSFI_SIGNATURE_HEADER, createTransfiAdapter } from "./transfi";
import {
  CREATE_ORDER_OFFRAMP,
  LIST_MIDS,
  NO_PAYMENT_METHODS,
  ORDER_CANCELLED,
  ORDER_FAILED,
  ORDER_INITIATED,
  PARTNER_ID_ALREADY_USED,
  PAYMENT_METHODS_IDR_PAGE_1,
  PAYMENT_METHODS_IDR_PAGE_2,
  PAYMENT_METHODS_PHP,
  QUOTED_AT,
  QUOTE_PAYIN_UNWRAPPED,
  QUOTE_PHP,
  TRANSFER_NOT_FOUND,
  WEBHOOK_FUND_SETTLED,
} from "./transfi.fixtures";

const WEBHOOK_SECRET = "transfi-test-webhook-secret";
const PAYOUT_ID = "po_01JC2X7Q9Z8K4M3N5P6R7S8T9V";
const ORDER_ID = CREATE_ORDER_OFFRAMP.data.orderId;
const SENDER = { userId: "UX-250930062608488", ip: "203.0.113.10" };
const RECIPIENT = {
  institutionCode: "gcash",
  accountNumber: "09171234567",
  accountName: "Maria Santos",
  phone: "+63 917 123 4567",
};

const QUOTE_REQUEST: QuoteRequest = {
  quoteId: "qt_transfi",
  corridor: { country: "PH", currency: "PHP", payoutType: "mobile_money" },
  source: { asset: "USDC", chain: "polygon" },
  amount: { side: "receive", minorUnits: 100_000n },
};

const methodsPath = (currency: string, page = 1) =>
  `/v3/config/payment-methods?direction=withdraw&currency=${currency}&headlessMode=true&userType=individual&limit=100&page=${page}`;
const ratesPath = (amount: string, direction: string) =>
  `/v3/exchange-rates?amount=${amount}&sourceCurrency=USDCPOLYGON&destinationCurrency=PHP&orderType=offramp&direction=${direction}`;

const EXCHANGES: RecordedExchange[] = [
  { method: "GET", path: methodsPath("IDR"), status: 200, body: PAYMENT_METHODS_IDR_PAGE_1 },
  { method: "GET", path: methodsPath("IDR", 2), status: 200, body: PAYMENT_METHODS_IDR_PAGE_2 },
  { method: "GET", path: methodsPath("PHP"), status: 200, body: PAYMENT_METHODS_PHP },
  { method: "GET", path: ratesPath("1000", "reverse"), status: 200, body: QUOTE_PHP },
  { method: "GET", path: ratesPath("17.17", "forward"), status: 200, body: QUOTE_PHP },
  { method: "POST", path: "/v3/orders", status: 200, body: CREATE_ORDER_OFFRAMP },
  { method: "POST", path: "/v3/orders/cancel", status: 200, body: ORDER_CANCELLED },
  { method: "GET", path: `/v3/orders/${PAYOUT_ID}`, status: 200, body: ORDER_INITIATED },
  { method: "GET", path: `/v3/orders/${ORDER_ID}`, status: 200, body: ORDER_INITIATED },
  { method: "GET", path: "/v3/orders/po_missing_reference", status: 400, body: TRANSFER_NOT_FOUND },
  { method: "GET", path: "/v3/config/list-mids", status: 200, body: LIST_MIDS },
];

function withResponse(method: string, path: string, body: unknown, status = 200): RecordedExchange[] {
  return [
    { method, path, status, body },
    ...EXCHANGES.filter((exchange) => !(exchange.method === method && exchange.path === path)),
  ];
}

function signed(body: unknown, secret = WEBHOOK_SECRET) {
  const rawBody = JSON.stringify(body);
  return { headers: { [TRANSFI_SIGNATURE_HEADER]: hmac("sha256", secret, rawBody, "hex") }, rawBody };
}

const webhookWith = (status: string, order: Record<string, unknown> = {}) => ({
  ...WEBHOOK_FUND_SETTLED,
  status,
  order: { ...WEBHOOK_FUND_SETTLED.order, ...order },
});

function setup(exchanges: RecordedExchange[] = EXCHANGES, webhookSecrets = [WEBHOOK_SECRET]) {
  const alerts: ProviderAlert[] = [];
  const clock = { now: QUOTED_AT };
  const replay = replayFetch(exchanges);
  const adapter = createTransfiAdapter({
    username: "test-user",
    password: "test-password",
    mid: "SABCDEF_SCT8YW_NA",
    environment: "sandbox",
    webhookSecrets,
    sender: SENDER,
    deps: { fetch: replay.fetch, alert: (alert) => alerts.push(alert), now: () => clock.now },
  });
  return { adapter, alerts, replay, clock };
}

async function loaded(exchanges: RecordedExchange[] = EXCHANGES) {
  const context = setup(exchanges);
  await context.adapter.refreshCapabilities();
  return context;
}

function orderRequest(
  quote: ProviderQuote,
  recipient: CreateOrderRequest["recipient"] = RECIPIENT,
  corridor = QUOTE_REQUEST.corridor,
): CreateOrderRequest {
  return {
    payoutId: PAYOUT_ID,
    quote,
    corridor,
    source: QUOTE_REQUEST.source,
    recipient,
    refundAddress: "0x5b7ae3c6c87f4a3f94b35c77233b13191ebfad20",
  };
}

const bodyOf = (call: { body: string } | undefined) => JSON.parse(call?.body ?? "{}");
const pathsOf = (calls: { method: string; path: string }[]) =>
  calls.map((call) => `${call.method} ${call.path}`);

describeAdapterContract("transfi", async () => {
  const { adapter, alerts } = await loaded();
  return {
    adapter,
    alerts,
    quoteRequest: QUOTE_REQUEST,
    orderRequest: (quote) => orderRequest(quote),
    unknownReference: "po_missing_reference",
    validWebhook: signed(WEBHOOK_FUND_SETTLED),
    expectedWebhookStatus: "paid",
    unmappableWebhook: signed(webhookWith("fund_teleported")),
    pii: [RECIPIENT.accountNumber, RECIPIENT.accountName, RECIPIENT.phone, "639171234567"],
    quotedAt: QUOTED_AT,
  };
});

describe("transfi adapter", () => {
  it("sends Basic credentials and the merchant id on every call", async () => {
    const { adapter, replay } = setup();
    await adapter.health();
    const headers = replay.calls[0]?.headers ?? {};
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("test-user:test-password").toString("base64")}`);
    expect(headers.mid).toBe("SABCDEF_SCT8YW_NA");
  });

  it("builds corridors and limits from every page of payment methods, skipping cards", async () => {
    const { adapter, replay } = await loaded();
    const capabilities = adapter.capabilities();
    expect(capabilities.custody).toBe("one_time_address");
    expect(capabilities.corridors).toEqual([
      { country: "ID", currency: "IDR", payoutType: "bank" },
      { country: "ID", currency: "IDR", payoutType: "mobile_money" },
      { country: "PH", currency: "PHP", payoutType: "bank" },
      { country: "PH", currency: "PHP", payoutType: "mobile_money" },
    ]);
    expect(capabilities.limits).toEqual({
      IDR: { side: "receive", min: 1_000_000n, max: 10_000_000_000n },
      PHP: { side: "receive", min: 100n, max: 50_000_000n },
    });
    expect(capabilities.sources).toContainEqual({ asset: "USDT", chain: "tron" });
    expect(capabilities.sources).not.toContainEqual({ asset: "USDT", chain: "base" });
    expect(pathsOf(replay.calls)).toEqual([
      `GET ${methodsPath("IDR")}`,
      `GET ${methodsPath("IDR", 2)}`,
      `GET ${methodsPath("PHP")}`,
    ]);
  });

  it("offers no corridor until the methods load, then refreshes them once a day", async () => {
    const { adapter, replay, clock } = setup();
    expect(adapter.capabilities().corridors).toEqual([]);
    await adapter.refreshCapabilities();
    expect(adapter.capabilities().corridors).toHaveLength(4);
    expect(replay.calls).toHaveLength(3);
    clock.now = new Date(QUOTED_AT.getTime() + 25 * 60 * 60 * 1000);
    adapter.capabilities();
    await adapter.refreshCapabilities();
    expect(replay.calls).toHaveLength(6);
  });

  it("drops a currency TransFi has no payout methods for", async () => {
    const { adapter } = await loaded(withResponse("GET", methodsPath("IDR"), NO_PAYMENT_METHODS, 404));
    expect(adapter.capabilities().corridors.map((corridor) => corridor.currency)).toEqual(["PHP", "PHP"]);
    expect(adapter.capabilities().limits.IDR).toBeUndefined();
  });

  it("quotes a receive amount in reverse and inverts the rate into pesos per USDC", async () => {
    const { adapter, replay } = await loaded();
    const quote = await adapter.quote(QUOTE_REQUEST);
    expect(replay.calls.at(-1)?.path).toBe(ratesPath("1000", "reverse"));
    expect(quote).toEqual({
      provider: "transfi",
      sendUnits: 17_170_000n,
      receiveMinorUnits: 100_000n,
      rate: "58.8235294117",
      fees: [{ kind: "provider", amount: 1_000n, unit: "PHP" }],
      expiresAt: new Date(QUOTED_AT.getTime() + 60_000),
    });
  });

  it("quotes a send amount forward and reads a body without the success envelope", async () => {
    const { adapter, replay } = await loaded(
      withResponse("GET", ratesPath("17.17", "forward"), QUOTE_PHP.data),
    );
    const quote = await adapter.quote({ ...QUOTE_REQUEST, amount: { side: "send", units: 17_170_000n } });
    expect(replay.calls.at(-1)?.path).toBe(ratesPath("17.17", "forward"));
    expect(quote.receiveMinorUnits).toBe(100_000n);
  });

  it("refuses a quote that prices another pair or another amount", async () => {
    const otherPair = await loaded(withResponse("GET", ratesPath("1000", "reverse"), QUOTE_PAYIN_UNWRAPPED));
    await expect(otherPair.adapter.quote(QUOTE_REQUEST)).rejects.toMatchObject({ kind: "invalid_response" });
    const short = await loaded(
      withResponse("GET", ratesPath("1000", "reverse"), {
        ...QUOTE_PHP,
        data: { ...QUOTE_PHP.data, destinationAmount: 999.99 },
      }),
    );
    await expect(short.adapter.quote(QUOTE_REQUEST)).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("refuses corridors and assets it does not serve", async () => {
    const { adapter, replay } = await loaded();
    const calls = replay.calls.length;
    await expect(
      adapter.quote({ ...QUOTE_REQUEST, corridor: { country: "NG", currency: "NGN", payoutType: "bank" } }),
    ).rejects.toMatchObject({ kind: "not_supported" });
    await expect(
      adapter.quote({ ...QUOTE_REQUEST, source: { asset: "USDT", chain: "base" } }),
    ).rejects.toMatchObject({ kind: "not_supported" });
    expect(replay.calls).toHaveLength(calls);
  });

  it("creates an off-ramp order fixed on the fiat side with our payout id as partnerId", async () => {
    const { adapter, replay } = await loaded();
    const quote = await adapter.quote(QUOTE_REQUEST);
    const order = await adapter.createOrder(orderRequest(quote));
    expect(bodyOf(replay.calls.at(-1))).toEqual({
      userId: SENDER.userId,
      orderType: "offramp",
      purposeCode: "remittance",
      partnerId: PAYOUT_ID,
      headlessMode: true,
      deviceDetails: { userAgent: "fliq-api", ipInfo: { ip: SENDER.ip } },
      source: { currency: "USDCPOLYGON" },
      destination: {
        currency: "PHP",
        amount: 1000,
        paymentType: "local_wallet",
        paymentCode: "gcash",
        additionalPaymentDetails: { phone: "639171234567" },
      },
    });
    expect(order).toEqual({
      providerOrderId: ORDER_ID,
      reference: PAYOUT_ID,
      funding: {
        kind: "deposit_address",
        chain: "polygon",
        asset: "USDC",
        address: CREATE_ORDER_OFFRAMP.data.walletAddress,
        units: 17_170_000n,
      },
    });
  });

  it("rounds an eight-decimal deposit up so TransFi is never underpaid", async () => {
    const { adapter } = await loaded(
      withResponse("POST", "/v3/orders", {
        ...CREATE_ORDER_OFFRAMP,
        data: { ...CREATE_ORDER_OFFRAMP.data, cryptoAmount: 17.16000001 },
      }),
    );
    const order = await adapter.createOrder(orderRequest(await adapter.quote(QUOTE_REQUEST)));
    expect(order.funding.units).toBe(17_160_001n);
  });

  it("cancels and refuses an order that asks for more crypto than quoted or has no address", async () => {
    for (const data of [
      { ...CREATE_ORDER_OFFRAMP.data, cryptoAmount: 17.180001 },
      { ...CREATE_ORDER_OFFRAMP.data, walletAddress: "" },
    ]) {
      const { adapter, replay } = await loaded(
        withResponse("POST", "/v3/orders", { ...CREATE_ORDER_OFFRAMP, data }),
      );
      await expect(adapter.createOrder(orderRequest(await adapter.quote(QUOTE_REQUEST)))).rejects.toThrow();
      expect(replay.calls.at(-1)).toMatchObject({ method: "POST", path: "/v3/orders/cancel" });
      expect(bodyOf(replay.calls.at(-1)).orderId).toBe(ORDER_ID);
    }
  });

  it("reports a reused partnerId by its code and never retries the create", async () => {
    const { adapter, replay } = await loaded(
      withResponse("POST", "/v3/orders", PARTNER_ID_ALREADY_USED, 400),
    );
    const quote = await adapter.quote(QUOTE_REQUEST);
    await expect(adapter.createOrder(orderRequest(quote))).rejects.toMatchObject({
      kind: "rejected",
      message: expect.stringContaining("PARTNER_ID_ALREADY_USED") as string,
    });
    expect(replay.calls.filter((call) => call.path === "/v3/orders")).toHaveLength(1);
  });

  it("never retries a create that timed out", async () => {
    const { adapter, replay } = await loaded(withResponse("POST", "/v3/orders", { status: "failure" }, 503));
    const quote = await adapter.quote(QUOTE_REQUEST);
    await expect(adapter.createOrder(orderRequest(quote))).rejects.toMatchObject({ kind: "unavailable" });
    expect(replay.calls.filter((call) => call.path === "/v3/orders")).toHaveLength(1);
  });

  it("refuses unknown codes, mismatched payout types and banks without an account field before calling", async () => {
    const { adapter, replay } = await loaded();
    const quote = await adapter.quote(QUOTE_REQUEST);
    const bank = { country: "PH", currency: "PHP", payoutType: "bank" } as const;
    const idrBank = { country: "ID", currency: "IDR", payoutType: "bank" } as const;
    await expect(
      adapter.createOrder(orderRequest(quote, { ...RECIPIENT, institutionCode: "nope" })),
    ).rejects.toMatchObject({ kind: "rejected" });
    await expect(adapter.createOrder(orderRequest(quote, RECIPIENT, bank))).rejects.toMatchObject({
      kind: "rejected",
    });
    await expect(
      adapter.createOrder(orderRequest(quote, { ...RECIPIENT, institutionCode: "bjb_syr" }, idrBank)),
    ).rejects.toMatchObject({ kind: "not_supported" });
    expect(replay.calls.some((call) => call.path === "/v3/orders")).toBe(false);
  });

  it("sends bank account fields named by the payment method", async () => {
    const { adapter, replay } = await loaded();
    const quote = await adapter.quote(QUOTE_REQUEST);
    const bank = { country: "PH", currency: "PHP", payoutType: "bank" } as const;
    await adapter.createOrder(orderRequest(quote, { ...RECIPIENT, institutionCode: "bdo" }, bank));
    expect(bodyOf(replay.calls.at(-1)).destination).toMatchObject({
      paymentType: "bank_transfer",
      paymentCode: "bdo",
      additionalPaymentDetails: {
        accountNumber: RECIPIENT.accountNumber,
        accountName: RECIPIENT.accountName,
      },
    });
  });

  it("reads orders by partnerId, treats only TRANSFER_NOT_FOUND as absent and maps fund_failed to a refund", async () => {
    const { adapter, replay } = setup();
    expect(await adapter.getOrder({ reference: PAYOUT_ID })).toEqual({
      providerOrderId: ORDER_ID,
      reference: PAYOUT_ID,
      status: "awaiting_deposit",
    });
    expect(replay.calls[0]?.path).toBe(`/v3/orders/${PAYOUT_ID}`);
    const failed = setup(withResponse("GET", `/v3/orders/${ORDER_ID}`, ORDER_FAILED));
    expect(await failed.adapter.getOrder({ providerOrderId: ORDER_ID })).toMatchObject({
      status: "refunding",
    });
    const refused = setup(
      withResponse("GET", "/v3/orders/po_missing_reference", PARTNER_ID_ALREADY_USED, 400),
    );
    await expect(refused.adapter.getOrder({ reference: "po_missing_reference" })).rejects.toMatchObject({
      kind: "rejected",
    });
    const missing = setup(withResponse("GET", "/v3/orders/po_missing_reference", { status: "failure" }, 404));
    await expect(missing.adapter.getOrder({ reference: "po_missing_reference" })).rejects.toMatchObject({
      kind: "rejected",
    });
  });

  it("maps every off-ramp webhook status and keys events on order and status", () => {
    const { adapter } = setup();
    const statusOf = (status: string, order?: Record<string, unknown>) =>
      adapter.parseWebhook(signed(webhookWith(status, order))).order;
    expect(statusOf("initiated")).toEqual({ status: "awaiting_deposit" });
    expect(statusOf("asset_deposited")).toEqual({ status: "deposit_received" });
    expect(statusOf("manual_review")).toEqual({ status: "processing" });
    expect(statusOf("fund_failed", { failureCode: "INVALID_ACCOUNT_DETAILS" })).toEqual({
      status: "refunding",
    });
    expect(statusOf("expired")).toEqual({ status: "failed", code: "expired", retryable: true });
    expect(statusOf("fund_settled", { bankTxnId: ["BTX-2041"] })).toEqual({
      status: "paid",
      fiatReference: "BTX-2041",
    });
    expect(adapter.parseWebhook(signed(WEBHOOK_FUND_SETTLED))).toEqual({
      eventId: "OR-260824111423413832397538943:fund_settled",
      providerOrderId: "OR-260824111423413832397538943",
      order: { status: "paid" },
    });
  });

  it("alerts on statuses and events it will not guess", () => {
    const { adapter, alerts } = setup();
    for (const body of [
      webhookWith("asset_settle_failed"),
      webhookWith("fund_settled", { type: "buy" }),
      { ...WEBHOOK_FUND_SETTLED, entityType: "user", status: "kyc_success" },
    ]) {
      expect(() => adapter.parseWebhook(signed(body))).toThrowError(
        expect.objectContaining({ kind: "unmappable_status" }) as Error,
      );
    }
    expect(alerts.map((alert) => alert.detail)).toEqual([
      "parseWebhook asset_settle_failed",
      "parseWebhook order type buy",
      "parseWebhook entityType user",
    ]);
  });

  it("accepts the previous webhook secret and an upper-case signature, and rejects an unsigned body", () => {
    const { adapter } = setup(EXCHANGES, [WEBHOOK_SECRET, "previous-secret"]);
    expect(adapter.parseWebhook(signed(WEBHOOK_FUND_SETTLED, "previous-secret")).order.status).toBe("paid");
    const upper = signed(WEBHOOK_FUND_SETTLED);
    const header = upper.headers[TRANSFI_SIGNATURE_HEADER].toUpperCase();
    expect(
      adapter.parseWebhook({ ...upper, headers: { [TRANSFI_SIGNATURE_HEADER]: header } }).order.status,
    ).toBe("paid");
    expect(() => adapter.parseWebhook({ headers: {}, rawBody: upper.rawBody })).toThrowError(
      expect.objectContaining({ kind: "invalid_signature" }) as Error,
    );
  });

  it("lists institutions from the payment methods, has no account lookup and reports health", async () => {
    const { adapter } = setup();
    expect(await adapter.institutions("PH")).toEqual([
      { code: "gcash", name: "GCash", type: "mobile_money" },
      { code: "paymaya", name: "Maya", type: "mobile_money" },
      { code: "bdo", name: "BDO Unibank", type: "bank" },
    ]);
    expect((await adapter.institutions("ID")).map((institution) => institution.code)).toEqual([
      "bjb",
      "bjb_syr",
      "ovo",
    ]);
    expect(await adapter.institutions("NG")).toEqual([]);
    await expect(
      adapter.verifyAccount({ institutionCode: "gcash", accountNumber: "09171234567", country: "PH" }),
    ).rejects.toMatchObject({ kind: "not_supported" });
    expect(await adapter.health()).toEqual({ healthy: true });
  });
});
