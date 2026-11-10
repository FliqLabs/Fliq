import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { describeAdapterContract } from "../contract/contract";
import { replayFetch, type RecordedExchange } from "../contract/replay";
import type { CreateOrderRequest, ProviderAlert, ProviderQuote, QuoteRequest } from "../types";
import { FONBNK_SIGNATURE_HEADER, createFonbnkAdapter, type FonbnkOptions } from "./fonbnk";
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

type SetupOptions = {
  webhookSecrets?: string[];
  // Served in order to POST /api/v2/quote before the recorded quote, so one test can see two different quotes.
  quotes?: unknown[];
  options?: Partial<FonbnkOptions>;
};

function setup(exchanges: RecordedExchange[] = EXCHANGES, setupOptions: SetupOptions = {}) {
  const alerts: ProviderAlert[] = [];
  const replay = replayFetch(exchanges);
  const queued = [...(setupOptions.quotes ?? [])];
  const fetchQuotes = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.pathname !== "/api/v2/quote" || queued.length === 0) return replay.fetch(input, init);
    replay.calls.push({ method: "POST", path: url.pathname, headers: {}, body: String(init?.body ?? "") });
    return new Response(JSON.stringify(queued.shift()), { status: 200 });
  };
  const adapter = createFonbnkAdapter({
    clientId: "test-client-id",
    signatureSecret: SIGNING_SECRET,
    webhookSecrets: setupOptions.webhookSecrets ?? [WEBHOOK_SECRET],
    environment: "sandbox",
    endUser: END_USER,
    deps: { fetch: fetchQuotes as typeof fetch, alert: (alert) => alerts.push(alert), now: () => QUOTED_AT },
    ...setupOptions.options,
  });
  return { adapter, alerts, replay };
}

const quoteWithFields = (fieldsToCreateOrder: unknown[]) => ({
  ...QUOTE,
  payout: { ...QUOTE.payout, fieldsToCreateOrder },
});

const [PHONE_FIELD, BANK_FIELD, ACCOUNT_FIELD] = QUOTE.payout.fieldsToCreateOrder;

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

  it("treats a missing route as retryable and an amount out of range as a limit, not a rejection", async () => {
    const unavailable = setup(
      withResponse("POST", "/api/v2/quote", { errorCode: "ROUTE_NOT_AVAILABLE" }, 404),
    );
    await expect(unavailable.adapter.quote(QUOTE_REQUEST)).rejects.toMatchObject({ kind: "unavailable" });
    const belowMinimum = setup(withResponse("POST", "/api/v2/quote", AMOUNT_BELOW_MINIMUM, 404));
    await expect(belowMinimum.adapter.quote(QUOTE_REQUEST)).rejects.toMatchObject({
      kind: "not_supported",
      message: expect.stringContaining("below the minimum"),
      reason: "AMOUNT_BELOW_MINIMUM: min 1494 max 747367 NGN",
    });
    const aboveMaximum = setup(
      withResponse(
        "POST",
        "/api/v2/quote",
        { ...AMOUNT_BELOW_MINIMUM, errorCode: "AMOUNT_ABOVE_MAXIMUM" },
        404,
      ),
    );
    await expect(aboveMaximum.adapter.quote(QUOTE_REQUEST)).rejects.toMatchObject({
      kind: "not_supported",
      message: expect.stringContaining("above the maximum"),
    });
    const badStep = setup(
      withResponse(
        "POST",
        "/api/v2/quote",
        { ...AMOUNT_BELOW_MINIMUM, errorCode: "AMOUNT_STEP_INVALID" },
        404,
      ),
    );
    await expect(badStep.adapter.quote(QUOTE_REQUEST)).rejects.toMatchObject({ kind: "rejected" });
  });

  it("creates the order with our payout id, the locked quote, its quoted amount and the recipient fields", async () => {
    const { adapter, replay } = setup();
    const quote = await adapter.quote(QUOTE_REQUEST);
    const order = await adapter.createOrder(orderRequest(quote));
    expect(replay.calls.map((call) => call.path)).toEqual([
      "/api/v2/quote",
      "/api/v2/quote",
      "/api/v2/order",
    ]);
    expect(bodyOf(replay.calls[2])).toEqual({
      quoteId: QUOTE.quoteId,
      userEmail: END_USER.email,
      userIp: END_USER.ip,
      userCountryIsoCode: "NG",
      deposit: { paymentChannel: "crypto", currencyType: "crypto", currencyCode: "POLYGON_USDT" },
      payout: {
        paymentChannel: "bank",
        currencyType: "fiat",
        currencyCode: "NGN",
        countryIsoCode: "NG",
        amount: 30000,
      },
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

  it("confirms the funding with the delivery transaction hash", async () => {
    const { adapter, replay } = setup();
    const confirmed = await adapter.confirmFunding(ORDER_ID, CONFIRM_HASH);
    expect(bodyOf(replay.calls[0])).toEqual({
      orderId: ORDER_ID,
      fieldsToConfirmOrder: { blockchainTransactionHash: CONFIRM_HASH },
    });
    expect(confirmed).toEqual({ providerOrderId: ORDER_ID, status: "deposit_received" });
  });

  it("reads the order instead of failing when Fonbnk refuses a second confirm", async () => {
    const refused = { message: "Order is not in a state that allows confirmation" };
    const { adapter, replay } = setup([
      { method: "POST", path: "/api/v2/order/confirm", status: 400, body: refused },
      {
        method: "GET",
        path: `/api/v2/order?orderId=${ORDER_ID}`,
        status: 200,
        body: orderWith({ status: "deposit_expired" }),
      },
    ]);
    expect(await adapter.confirmFunding(ORDER_ID, CONFIRM_HASH)).toEqual({
      providerOrderId: ORDER_ID,
      status: "failed",
      code: "deposit_expired",
      retryable: true,
    });
    expect(replay.calls.map((call) => call.method)).toEqual(["POST", "GET"]);
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
    expect(await statusOf({ status: "deposit_canceled" })).toMatchObject({
      status: "failed",
      code: "deposit_expired",
      retryable: true,
    });
    expect(
      await statusOf({
        status: "refund_successful",
        refund: { transaction: { meta: { transactionHash: CONFIRM_HASH } } },
      }),
    ).toMatchObject({ status: "refunded", refundTxHash: CONFIRM_HASH });
  });

  it("keys webhook events on order, status and update time, and accepts the previous secret", () => {
    const { adapter } = setup(EXCHANGES, { webhookSecrets: [WEBHOOK_SECRET, "previous-secret"] });
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

  it("vouches for an offered institution and a well-formed number, never for a name", async () => {
    const { adapter, replay } = setup();
    const verify = (institutionCode: string, accountNumber: string, country: "NG" | "KE" | "GH") =>
      adapter.verifyAccount({ institutionCode, accountNumber, country });
    const vouched = { found: true, accountName: null };
    expect(await verify("1", "1234567890", "NG")).toEqual(vouched);
    expect(await verify("1", "12345", "NG")).toEqual({ found: false });
    await expect(verify("99", "1234567890", "NG")).rejects.toMatchObject({ kind: "not_supported" });
    expect(await verify("ke_safaricom", "0712345678", "KE")).toEqual(vouched);
    expect(await verify("ke_safaricom", "+254 112 345 678", "KE")).toEqual(vouched);
    expect(await verify("ke_safaricom", "12345", "KE")).toEqual({ found: false });
    expect(await verify("2", "00112233", "KE")).toEqual(vouched);
    await expect(verify("1", "0241234567", "GH")).rejects.toMatchObject({ kind: "not_supported" });
    expect(replay.calls.filter((call) => call.path === "/api/v2/quote")).toHaveLength(2);
  });

  it("reports health from the currency list", async () => {
    const { adapter } = setup();
    expect(await adapter.health()).toEqual({ healthy: true });
  });

  it("declares the sandbox and that only a 1Click hop can fund it", () => {
    expect(setup().adapter.capabilities()).toMatchObject({
      sandbox: true,
      funding: { direct: false, hop: true },
    });
    const production = setup(EXCHANGES, { options: { environment: "production" } });
    expect(production.adapter.capabilities().sandbox).toBe(false);
  });

  it("takes the bank code from the order's own quote, matched by the bank's name", async () => {
    const orderQuote = quoteWithFields([
      PHONE_FIELD,
      {
        ...BANK_FIELD,
        options: [
          { label: "Sandbox Bank 2", value: "70" },
          { label: "Sandbox Bank", value: "71" },
        ],
      },
      ACCOUNT_FIELD,
    ]);
    const { adapter, replay } = setup(EXCHANGES, { quotes: [orderQuote] });
    const quote = await adapter.quote(QUOTE_REQUEST);
    await adapter.createOrder(orderRequest(quote));
    expect(bodyOf(replay.calls.at(-1)).fieldsToCreateOrder.bankCode).toBe("71");
  });

  it("refuses before calling Fonbnk when the order's quote does not list the bank", async () => {
    const orderQuote = quoteWithFields([
      PHONE_FIELD,
      { ...BANK_FIELD, options: [{ label: "Sandbox Bank 2", value: "70" }] },
      ACCOUNT_FIELD,
    ]);
    const { adapter, replay } = setup(EXCHANGES, { quotes: [orderQuote] });
    const quote = await adapter.quote(QUOTE_REQUEST);
    await expect(adapter.createOrder(orderRequest(quote))).rejects.toMatchObject({ kind: "rejected" });
    expect(replay.calls.map((call) => call.path)).not.toContain("/api/v2/order");
  });

  it("asks for the quote's fields again when it no longer has them, keeping the quote id", async () => {
    const quote = await setup().adapter.quote(QUOTE_REQUEST);
    const { adapter, replay } = setup();
    await adapter.createOrder(orderRequest(quote));
    expect(bodyOf(replay.calls[0]).deposit.amount).toBe(21.272315);
    const created = bodyOf(replay.calls.at(-1));
    expect(created.quoteId).toBe(QUOTE.quoteId);
    expect(created.deposit.amount).toBe(21.272315);
    expect(created.fieldsToCreateOrder.bankCode).toBe("1");
  });

  it("builds the recipient fields from the quote's list, with its default values", async () => {
    const orderQuote = quoteWithFields([
      ...QUOTE.payout.fieldsToCreateOrder,
      { key: "bankAccountHolderName", label: "Account name", required: true, type: "string" },
      {
        key: "payoutSandboxForcedFlow",
        label: "Flow",
        required: false,
        type: "enum",
        defaultValue: "payout_success",
      },
      { key: "promoCode", label: "Promo", required: false, type: "string" },
    ]);
    const { adapter, replay } = setup(EXCHANGES, { quotes: [orderQuote] });
    await adapter.createOrder(orderRequest(await adapter.quote(QUOTE_REQUEST)));
    expect(bodyOf(replay.calls.at(-1)).fieldsToCreateOrder).toEqual({
      phoneNumber: "2348012345678",
      bankCode: "1",
      bankAccountNumber: "1234567890",
      bankAccountHolderName: "Ada Obi",
      payoutSandboxForcedFlow: "payout_success",
    });
  });

  it("refuses before calling Fonbnk when a required field has no value", async () => {
    const orderQuote = quoteWithFields([
      ...QUOTE.payout.fieldsToCreateOrder,
      { key: "narration", label: "Narration", required: true, type: "string" },
    ]);
    const { adapter, replay } = setup(EXCHANGES, { quotes: [orderQuote] });
    const quote = await adapter.quote(QUOTE_REQUEST);
    await expect(adapter.createOrder(orderRequest(quote))).rejects.toMatchObject({ kind: "rejected" });
    expect(replay.calls.map((call) => call.path)).not.toContain("/api/v2/order");
  });

  it("pays M-Pesa to the account number and sends the carrier the quote asks for", async () => {
    const mpesaQuote = quoteWithFields([
      { key: "phoneNumber", label: "Phone Number", required: true, type: "phone" },
      { key: "carrierCode", label: "Carrier", required: true, type: "enum" },
    ]);
    const { adapter, replay } = setup(EXCHANGES, { quotes: [mpesaQuote] });
    const corridor = { country: "KE", currency: "KES", payoutType: "mobile_money" } as const;
    const quote = await adapter.quote({ ...QUOTE_REQUEST, corridor });
    const mpesa = { institutionCode: "ke_safaricom", accountNumber: "0712345678", accountName: "Wanjiru" };
    await adapter.createOrder({ ...orderRequest(quote, mpesa), corridor });
    expect(replay.calls.map((call) => call.path)).toEqual(["/api/v2/quote", "/api/v2/order"]);
    expect(bodyOf(replay.calls[1]).fieldsToCreateOrder).toEqual({
      phoneNumber: "254712345678",
      carrierCode: "ke_safaricom",
    });
  });

  it("uses fliq's own number only when the quote requires a phone the sender did not give", async () => {
    const { adapter, replay } = setup(EXCHANGES, { options: { defaultPhone: "+234 801 000 0000" } });
    const { phone: _phone, ...noPhone } = RECIPIENT;
    await adapter.createOrder(orderRequest(await adapter.quote(QUOTE_REQUEST), noPhone));
    expect(bodyOf(replay.calls.at(-1)).fieldsToCreateOrder.phoneNumber).toBe("2348010000000");
    const optional = quoteWithFields([{ ...PHONE_FIELD, required: false }, BANK_FIELD, ACCOUNT_FIELD]);
    const second = setup(EXCHANGES, { quotes: [optional], options: { defaultPhone: "2348010000000" } });
    await second.adapter.createOrder(orderRequest(await second.adapter.quote(QUOTE_REQUEST), noPhone));
    expect(bodyOf(second.replay.calls.at(-1)).fieldsToCreateOrder.phoneNumber).toBeUndefined();
  });

  it("gives each sender a stable alias on our email domain", async () => {
    const { adapter, replay } = setup();
    const quote = await adapter.quote(QUOTE_REQUEST);
    await adapter.createOrder({
      ...orderRequest(quote),
      sender: { pseudonym: "3F9A0C1D2E4B5A6978C0D1E2F3A4B5C6D7E8F9A0" },
    });
    expect(bodyOf(replay.calls.at(-1))).toMatchObject({
      userEmail: "u-3f9a0c1d2e4b5a6978c0d1e2@fliq.example",
      userIp: END_USER.ip,
    });
  });

  it("moves an invalid deposit to refunding and alerts once", async () => {
    const { adapter, alerts } = setup(
      withResponse("GET", `/api/v2/order?orderId=${ORDER_ID}`, orderWith({ status: "deposit_invalid" })),
    );
    expect(await adapter.getOrder({ providerOrderId: ORDER_ID })).toMatchObject({ status: "refunding" });
    await adapter.getOrder({ providerOrderId: ORDER_ID });
    expect(alerts).toEqual([
      { provider: "fonbnk", kind: "unmappable_status", detail: expect.stringContaining(ORDER_ID) },
    ]);
  });

  it("returns the bank reference once the order is paid", async () => {
    const paid = orderWith({
      status: "payout_successful",
      payout: {
        ...CREATE_ORDER.order.payout,
        transaction: { meta: { paymentChannelAdditionalInfo: "NIP-000123" } },
      },
    });
    const { adapter } = setup(withResponse("GET", `/api/v2/order?orderId=${ORDER_ID}`, paid));
    expect(await adapter.getOrder({ providerOrderId: ORDER_ID })).toEqual({
      providerOrderId: ORDER_ID,
      status: "paid",
      fiatReference: "NIP-000123",
    });
  });
});
