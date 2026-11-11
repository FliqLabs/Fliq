import { describe, expect, it } from "vitest";
import { hmac } from "../../webhooks/hmac";
import { describeAdapterContract } from "../contract/contract";
import { replayFetch, type RecordedExchange } from "../contract/replay";
import type { Corridor, CreateOrderRequest, ProviderAlert, ProviderQuote, QuoteRequest } from "../types";
import { BITNOB_EVENT_ID_HEADER, BITNOB_SIGNATURE_HEADER, createBitnobAdapter } from "./bitnob";
import {
  BALANCE_USDT,
  BANKS_NG,
  INITIALIZE_ONCHAIN,
  LOOKUP,
  LOOKUP_FAILED,
  LOOKUP_ROUTE_DISABLED,
  NOT_FOUND,
  ONCHAIN_PAYOUT,
  PAYOUT,
  PAYOUT_LIST,
  PAYOUT_LIST_EMPTY,
  PAYOUT_SUCCESS,
  QUOTE_ONCHAIN_GHS,
  QUOTE_WITH_FEE,
  WEBHOOK_FAILED,
  WEBHOOK_SUCCESS,
  WHOAMI,
} from "./bitnob.fixtures";

const SECRET = "bitnob-webhook-test-secret";
const CLIENT_ID = "86f1b05e-2e35-40bf-a85d-fd3de44d216b";
const CLIENT_SECRET = "bitnob-client-test-secret";
const NOW = new Date("2026-10-30T09:15:02Z");
const PAYOUT_ID = ONCHAIN_PAYOUT.reference;
const GH_MOMO: Corridor = { country: "GH", currency: "GHS", payoutType: "mobile_money" };
const GH_BANK: Corridor = { country: "GH", currency: "GHS", payoutType: "bank" };
const NG_BANK: Corridor = { country: "NG", currency: "NGN", payoutType: "bank" };
const RECIPIENT = { institutionCode: "mtn", accountNumber: "233240000001", accountName: "Kwame Mensah" };
const PAYOUT_PATH = `/api/payouts/${ONCHAIN_PAYOUT.id}`;
const MTN_LOOKUP_PATH =
  "/api/payouts/account-lookup?country=GH&type=mobile_money&bank_code=MTN&account_number=0240000001";

function listPath(offset = 0): string {
  const query = new URLSearchParams({
    limit: "50",
    offset: String(offset),
    source: "onchain",
    from_date: "2026-10-29T09:15:02.000Z",
  });
  return `/api/payouts?${query.toString()}`;
}

const QUOTE_REQUEST: QuoteRequest = {
  quoteId: "pending",
  corridor: GH_MOMO,
  source: { asset: "USDT", chain: "tron" },
  amount: { side: "receive", minorUnits: 150_000n },
};

function orderRequest(quote: ProviderQuote, recipient = RECIPIENT): CreateOrderRequest {
  return {
    payoutId: PAYOUT_ID,
    quote,
    corridor: GH_MOMO,
    source: QUOTE_REQUEST.source,
    recipient,
    refundAddress: "",
  };
}

function withPayout(fields: Record<string, unknown>, body: { data: { payout: object } } = PAYOUT) {
  return { ...body, data: { ...body.data, payout: { ...body.data.payout, ...fields } } };
}

const EXCHANGES: RecordedExchange[] = [
  { method: "POST", path: "/api/payouts/quotes", status: 200, body: QUOTE_ONCHAIN_GHS },
  { method: "POST", path: "/api/payouts/QT2_100483/initialize", status: 200, body: INITIALIZE_ONCHAIN },
  { method: "GET", path: listPath(), status: 200, body: PAYOUT_LIST },
  { method: "GET", path: PAYOUT_PATH, status: 200, body: PAYOUT },
  { method: "GET", path: "/api/whoami", status: 200, body: WHOAMI },
  { method: "GET", path: "/api/balances/USDT", status: 200, body: BALANCE_USDT },
  { method: "GET", path: "/api/payouts/banks/NG", status: 200, body: BANKS_NG },
];

function setup(
  options: {
    exchanges?: RecordedExchange[];
    corridors?: Corridor[];
    environment?: "sandbox" | "production";
    callbackUrl?: string;
  } = {},
) {
  const alerts: ProviderAlert[] = [];
  const replay = replayFetch(options.exchanges ?? EXCHANGES);
  const adapter = createBitnobAdapter({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    webhookSecrets: [SECRET],
    expectedEnvironment: options.environment ?? "sandbox",
    corridors: options.corridors ?? [GH_MOMO],
    ...(options.callbackUrl ? { callbackUrl: options.callbackUrl } : {}),
    nonce: () => "0123456789abcdef0123456789abcdef",
    deps: { fetch: replay.fetch, alert: (alert) => alerts.push(alert), now: () => NOW },
  });
  return { adapter, alerts, replay };
}

// Answers successive calls with successive bodies, for a re-quote that must see a different price.
function sequenceSetup(bodies: unknown[], corridors: Corridor[]) {
  const sent: string[] = [];
  const fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    sent.push(typeof init?.body === "string" ? init.body : "");
    return new Response(JSON.stringify(bodies[sent.length - 1]), { status: 200 });
  }) as typeof globalThis.fetch;
  const adapter = createBitnobAdapter({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    webhookSecrets: [SECRET],
    expectedEnvironment: "sandbox",
    corridors,
    deps: { fetch, alert: () => {}, now: () => NOW },
  });
  return { adapter, sent: () => sent.map((body) => JSON.parse(body) as Record<string, unknown>) };
}

function signed(body: unknown) {
  const rawBody = JSON.stringify(body);
  return {
    headers: {
      [BITNOB_SIGNATURE_HEADER]: hmac("sha512", SECRET, rawBody, "hex"),
      [BITNOB_EVENT_ID_HEADER]: (body as { event_id?: string }).event_id,
    },
    rawBody,
  };
}

describeAdapterContract("bitnob", () => {
  const { adapter, alerts } = setup();
  return {
    adapter,
    alerts,
    quoteRequest: QUOTE_REQUEST,
    orderRequest: (quote) => orderRequest(quote),
    unknownReference: "po_missing",
    validWebhook: signed(WEBHOOK_SUCCESS),
    expectedWebhookStatus: "paid",
    unmappableWebhook: signed({ ...WEBHOOK_SUCCESS, event: "payouts.withdrawal.reversed" }),
    pii: [RECIPIENT.accountNumber, RECIPIENT.accountName],
    quotedAt: new Date(QUOTE_ONCHAIN_GHS.data.payout.trip.quote_at),
  };
});

describe("bitnob adapter", () => {
  it("declares per-order on-chain funding and the environment", () => {
    const sandbox = setup().adapter.capabilities();
    expect(sandbox).toMatchObject({ custody: "per_order_address", sandbox: true });
    expect(sandbox.sources.slice(0, 3)).toEqual([
      { asset: "USDC", chain: "base" },
      { asset: "USDC", chain: "polygon" },
      { asset: "USDT", chain: "polygon" },
    ]);
    expect(sandbox.funding).toBeUndefined();
    expect(setup({ environment: "production" }).adapter.capabilities().sandbox).toBe(false);
  });

  it("signs the exact body and quotes on-chain without a reference", async () => {
    const { adapter, replay } = setup();
    await adapter.quote(QUOTE_REQUEST);
    const call = replay.calls[0]!;
    const timestamp = String(Math.floor(NOW.getTime() / 1000));
    expect(call.headers["X-Auth-Client"]).toBe(CLIENT_ID);
    expect(call.headers["X-Auth-Timestamp"]).toBe(timestamp);
    expect(call.headers["X-Auth-Signature"]).toBe(
      hmac(
        "sha256",
        CLIENT_SECRET,
        `${CLIENT_ID}:${timestamp}:0123456789abcdef0123456789abcdef:${call.body}`,
        "hex",
      ),
    );
    expect(JSON.parse(call.body)).toEqual({
      from_asset: "USDT",
      to_currency: "GHS",
      source: "onchain",
      chain: "TRON",
      country: "GH",
      settlement_amount: "1500",
    });
  });

  it("reads total_amount, source_fee and settlement_amount in integer units", async () => {
    const quote = await setup().adapter.quote(QUOTE_REQUEST);
    expect(quote).toEqual({
      provider: "bitnob",
      providerQuoteId: "QT2_100483",
      sendUnits: 98_881_974n,
      receiveMinorUnits: 150_000n,
      rate: "15.1696000729111658",
      fees: [{ kind: "provider", amount: 0n, unit: "USDT" }],
      estimatedSettleSeconds: 60,
      expiresAt: new Date("2026-10-30T09:31:02.481Z"),
    });
  });

  it("maps our chain to Bitnob's and refuses sources and corridors it does not serve", async () => {
    const { adapter, replay } = setup();
    await adapter.quote({ ...QUOTE_REQUEST, source: { asset: "USDC", chain: "base" } });
    expect(JSON.parse(replay.calls[0]!.body)).toMatchObject({ from_asset: "USDC", chain: "BASE" });
    await expect(
      adapter.quote({ ...QUOTE_REQUEST, source: { asset: "USDC", chain: "stellar" } }),
    ).rejects.toMatchObject({ kind: "not_supported" });
    await expect(
      adapter.quote({ ...QUOTE_REQUEST, source: { asset: "USDC", chain: "tron" } }),
    ).rejects.toMatchObject({ kind: "not_supported" });
    await expect(adapter.quote({ ...QUOTE_REQUEST, corridor: NG_BANK })).rejects.toMatchObject({
      kind: "not_supported",
    });
    expect(replay.calls).toHaveLength(1);
  });

  it("sends exactly the requested units, fee included", async () => {
    const { adapter, sent } = sequenceSetup([QUOTE_WITH_FEE], [NG_BANK]);
    const quote = await adapter.quote({
      ...QUOTE_REQUEST,
      corridor: NG_BANK,
      amount: { side: "send", units: 100_500_000n },
    });
    expect(sent()).toEqual([
      {
        from_asset: "USDT",
        to_currency: "NGN",
        source: "onchain",
        chain: "TRON",
        country: "NG",
        amount_in_base_units: "100500000",
      },
    ]);
    expect(quote).toMatchObject({
      sendUnits: 100_500_000n,
      receiveMinorUnits: 14_970_000n,
      fees: [{ kind: "provider", amount: 500_000n, unit: "USDT" }],
    });
  });

  it("re-quotes once without the fee when the fee would push the total over", async () => {
    const lowered = withPayout({ amount: "99.5", total_amount: "100" }, QUOTE_WITH_FEE);
    const { adapter, sent } = sequenceSetup([QUOTE_WITH_FEE, lowered], [NG_BANK]);
    const quote = await adapter.quote({
      ...QUOTE_REQUEST,
      corridor: NG_BANK,
      amount: { side: "send", units: 100_000_000n },
    });
    expect(sent().map((body) => body.amount_in_base_units)).toEqual(["100000000", "99500000"]);
    expect(quote.sendUnits).toBe(100_000_000n);

    const stillOver = sequenceSetup([QUOTE_WITH_FEE, QUOTE_WITH_FEE], [NG_BANK]);
    await expect(
      stillOver.adapter.quote({
        ...QUOTE_REQUEST,
        corridor: NG_BANK,
        amount: { side: "send", units: 100_000_000n },
      }),
    ).rejects.toMatchObject({ kind: "rejected" });
  });

  it("initializes with our payout id and returns the deposit address, never calling finalize", async () => {
    const { adapter, replay } = setup({ callbackUrl: "https://api.example/hooks/bitnob" });
    const order = await adapter.createOrder(orderRequest(await adapter.quote(QUOTE_REQUEST)));
    expect(replay.calls.map((call) => call.path)).toEqual([
      "/api/payouts/quotes",
      "/api/payouts/QT2_100483/initialize",
    ]);
    expect(replay.calls.some((call) => call.path.endsWith("/finalize"))).toBe(false);
    expect(JSON.parse(replay.calls[1]!.body)).toEqual({
      reference: PAYOUT_ID,
      beneficiary: {
        destination_type: "mobile_money",
        country: "GH",
        account_name: "Kwame Mensah",
        account_number: "0240000001",
        network: "mtn",
      },
      callback_url: "https://api.example/hooks/bitnob",
    });
    expect(order).toEqual({
      providerOrderId: ONCHAIN_PAYOUT.id,
      reference: PAYOUT_ID,
      funding: {
        kind: "deposit_address",
        chain: "tron",
        asset: "USDT",
        address: "TExampleSandboxDeposit000000000002",
        units: 98_881_974n,
        validUntil: new Date("2026-10-30T09:31:02Z"),
      },
    });
  });

  it("refuses an initialize that is not awaiting a deposit or asks for more than the quote", async () => {
    const quote = await setup().adapter.quote(QUOTE_REQUEST);
    const initialize = (body: unknown) =>
      setup({
        exchanges: [{ method: "POST", path: "/api/payouts/QT2_100483/initialize", status: 200, body }],
      }).adapter.createOrder(orderRequest(quote));
    await expect(initialize(withPayout({ status: "INITIATED" }, INITIALIZE_ONCHAIN))).rejects.toMatchObject({
      kind: "invalid_response",
    });
    await expect(
      initialize(withPayout({ deposit_amount: "99.381974" }, INITIALIZE_ONCHAIN)),
    ).rejects.toMatchObject({ kind: "rejected" });
    await expect(
      initialize(withPayout({ chain: "CHAIN_TYPE_ETHEREUM" }, INITIALIZE_ONCHAIN)),
    ).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("trusts the network the sender picked and sends the national number format", async () => {
    const { adapter, replay } = setup({ exchanges: EXCHANGES.slice(1, 2) });
    const quote = { providerQuoteId: "QT2_100483", sendUnits: 98_881_974n } as ProviderQuote;
    await adapter.createOrder(orderRequest(quote, { ...RECIPIENT, institutionCode: "vodafone" }));
    expect(JSON.parse(replay.calls[0]!.body).beneficiary).toMatchObject({
      account_number: "0240000001",
      network: "vodafone",
    });
    await expect(
      adapter.createOrder(orderRequest(quote, { ...RECIPIENT, accountNumber: "24000001" })),
    ).rejects.toMatchObject({ kind: "rejected" });
  });

  it("looks up MTN wallets and lets the sender name Telecel and AirtelTigo wallets", async () => {
    const { adapter, replay } = setup({
      exchanges: [{ method: "GET", path: MTN_LOOKUP_PATH, status: 200, body: LOOKUP }],
    });
    expect(
      await adapter.verifyAccount({ country: "GH", institutionCode: "mtn", accountNumber: "0240000001" }),
    ).toEqual({ found: true, accountName: "KWAME MENSAH" });
    for (const institutionCode of ["vodafone", "airtel"]) {
      expect(
        await adapter.verifyAccount({ country: "GH", institutionCode, accountNumber: "233201234567" }),
      ).toEqual({ found: true, accountName: null });
    }
    expect(replay.calls).toHaveLength(1);
    await expect(
      adapter.verifyAccount({ country: "GH", institutionCode: "airtel", accountNumber: "12345" }),
    ).rejects.toMatchObject({ kind: "rejected" });
  });

  it("checks Ghana bank accounts by format only, and only when bank payouts are on", async () => {
    const check = { country: "GH" as const, institutionCode: "GH190100", accountNumber: "9040001234567" };
    await expect(setup().adapter.verifyAccount(check)).rejects.toMatchObject({ kind: "not_supported" });
    const banks = setup({ corridors: [GH_MOMO, GH_BANK] });
    expect(await banks.adapter.verifyAccount(check)).toEqual({ found: true, accountName: null });
    expect(banks.replay.calls).toHaveLength(0);
  });

  it("reads a failed lookup as not found and a disabled route as unavailable", async () => {
    const lookup = (body: unknown) =>
      setup({
        exchanges: [{ method: "GET", path: MTN_LOOKUP_PATH, status: 400, body }],
      }).adapter.verifyAccount({
        country: "GH",
        institutionCode: "mtn",
        accountNumber: "0240000001",
      });
    expect(await lookup(LOOKUP_FAILED)).toEqual({ found: false });
    await expect(lookup(LOOKUP_ROUTE_DISABLED)).rejects.toMatchObject({ kind: "unavailable" });
    await expect(lookup({ ...LOOKUP_FAILED, detail: "Invalid beneficiary type" })).rejects.toMatchObject({
      kind: "rejected",
    });
  });

  it("lists Ghana networks without a call and banks from the API", async () => {
    const ghana = setup();
    expect(await ghana.adapter.institutions("GH")).toEqual([
      { code: "mtn", name: "MTN MoMo", type: "mobile_money" },
      { code: "vodafone", name: "Telecel Cash", type: "mobile_money" },
      { code: "airtel", name: "AirtelTigo Money", type: "mobile_money" },
    ]);
    expect(ghana.replay.calls).toHaveLength(0);
    expect(await setup({ corridors: [NG_BANK] }).adapter.institutions("NG")).toEqual([
      { code: "110072", name: "78 FINANCE COMPANY LIMITED", type: "bank" },
      { code: "090629", name: "9JAPAY MICROFINANCE BANK", type: "bank" },
    ]);
  });

  it("maps every documented payout status and alerts on anything else", async () => {
    const expectations: Record<string, object> = {
      INITIATED: { status: "awaiting_deposit" },
      PENDING_ADDRESS_DEPOSIT: { status: "awaiting_deposit" },
      PENDING: { status: "processing" },
      PROCESSING: { status: "processing" },
      SUCCESS: { status: "paid" },
      FAILED: { status: "refunding" },
      UNDERPAYMENT: { status: "refunding" },
      EXPIRED: { status: "failed", code: "deposit_expired", retryable: true },
    };
    for (const [status, normalized] of Object.entries(expectations)) {
      const { adapter, alerts } = setup({
        exchanges: [{ method: "GET", path: PAYOUT_PATH, status: 200, body: withPayout({ status }) }],
      });
      const order = await adapter.getOrder({ providerOrderId: ONCHAIN_PAYOUT.id });
      expect(order).toEqual({ providerOrderId: ONCHAIN_PAYOUT.id, reference: PAYOUT_ID, ...normalized });
      const refunded = status === "FAILED" || status === "UNDERPAYMENT";
      expect(alerts.map((alert) => alert.kind)).toEqual(refunded ? ["custodial_refund"] : []);
    }
    const { adapter, alerts } = setup({
      exchanges: [{ method: "GET", path: PAYOUT_PATH, status: 200, body: withPayout({ status: "QUOTE" }) }],
    });
    await expect(adapter.getOrder({ providerOrderId: ONCHAIN_PAYOUT.id })).rejects.toMatchObject({
      kind: "unmappable_status",
    });
    expect(alerts).toHaveLength(1);
  });

  it("keeps the settlement id as the payout reference and reads an unknown id as absent", async () => {
    const id = PAYOUT_SUCCESS.data.payout.id;
    const { adapter } = setup({
      exchanges: [
        { method: "GET", path: `/api/payouts/${id}`, status: 200, body: PAYOUT_SUCCESS },
        {
          method: "GET",
          path: "/api/payouts/019a0000-0000-7000-8000-000000000000",
          status: 404,
          body: NOT_FOUND,
        },
      ],
    });
    expect(await adapter.getOrder({ providerOrderId: id })).toMatchObject({
      status: "paid",
      fiatReference: "sandbox_txn_bfc22197-4be8-4f42-b682-a2e73b027b02",
    });
    expect(await adapter.getOrder({ providerOrderId: "019a0000-0000-7000-8000-000000000000" })).toBeNull();
  });

  it("finds an order by reference across pages of recent payouts", async () => {
    const firstPage = { ...PAYOUT_LIST_EMPTY, data: { ...PAYOUT_LIST_EMPTY.data, has_more: true } };
    const { adapter, replay } = setup({
      exchanges: [
        { method: "GET", path: listPath(0), status: 200, body: firstPage },
        { method: "GET", path: listPath(50), status: 200, body: PAYOUT_LIST },
      ],
    });
    expect(await adapter.getOrder({ reference: PAYOUT_ID })).toMatchObject({
      providerOrderId: ONCHAIN_PAYOUT.id,
      status: "awaiting_deposit",
    });
    expect(replay.calls).toHaveLength(2);
  });

  it("never reads a reference as absent unless every recent payout was read", async () => {
    const endless = { ...PAYOUT_LIST_EMPTY, data: { ...PAYOUT_LIST_EMPTY.data, has_more: true } };
    const exchanges = Array.from({ length: 10 }, (_, page) => ({
      method: "GET",
      path: listPath(page * 50),
      status: 200,
      body: endless,
    }));
    await expect(setup({ exchanges }).adapter.getOrder({ reference: PAYOUT_ID })).rejects.toMatchObject({
      kind: "unavailable",
    });
    expect(await setup().adapter.getOrder({ reference: "po_missing" })).toBeNull();
  });

  it("dedupes webhooks on Bitnob's event id and maps an expired deposit window", () => {
    const { adapter } = setup();
    expect(adapter.parseWebhook(signed(WEBHOOK_SUCCESS)).eventId).toBe("d9c4758ub-5e93-4cdf-bb123-frt474865");
    const expired = adapter.parseWebhook(signed({ ...WEBHOOK_SUCCESS, event: "payouts.withdrawal.expired" }));
    expect(expired.order).toEqual({ status: "failed", code: "deposit_expired", retryable: true });
  });

  it("maps a failed payout to refunding and tells an operator the funds sit in our balance", () => {
    const { adapter, alerts } = setup();
    const event = adapter.parseWebhook(signed(WEBHOOK_FAILED));
    expect(event).toEqual({
      eventId: WEBHOOK_FAILED.event_id,
      providerOrderId: WEBHOOK_FAILED.data.id,
      reference: WEBHOOK_FAILED.data.reference,
      order: { status: "refunding" },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ provider: "bitnob", kind: "custodial_refund" });
    expect(alerts[0]!.detail).toContain(WEBHOOK_FAILED.data.id);
    expect(alerts[0]!.detail).not.toContain("4000");
  });

  it("reads the balance in base units", async () => {
    expect(await setup().adapter.balance?.("USDT")).toBe(5_017_200n);
  });

  it("is healthy only when the key is active in the expected environment", async () => {
    const live = { ...WHOAMI, data: { ...WHOAMI.data, environment: "live" } };
    const liveExchanges = [{ method: "GET", path: "/api/whoami", status: 200, body: live }];
    expect(await setup().adapter.health()).toEqual({ healthy: true });
    expect(await setup({ environment: "production" }).adapter.health()).toEqual({ healthy: false });
    expect(await setup({ environment: "production", exchanges: liveExchanges }).adapter.health()).toEqual({
      healthy: true,
    });
    expect(await setup({ exchanges: liveExchanges }).adapter.health()).toEqual({ healthy: false });
  });
});
