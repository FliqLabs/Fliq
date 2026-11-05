import { describe, expect, it } from "vitest";
import { hmac } from "../../webhooks/hmac";
import { describeAdapterContract } from "../contract/contract";
import { replayFetch, type RecordedExchange } from "../contract/replay";
import type { Corridor, CreateOrderRequest, ProviderAlert, ProviderQuote, QuoteRequest } from "../types";
import { BITNOB_EVENT_ID_HEADER, BITNOB_SIGNATURE_HEADER, createBitnobAdapter } from "./bitnob";
import {
  BALANCE_USDT,
  BANKS_NG,
  BY_REFERENCE,
  FINALIZE,
  INITIALIZE,
  LOOKUP,
  NOT_FOUND,
  QUOTE,
  WEBHOOK_SUCCESS,
  WHOAMI,
} from "./bitnob.fixtures";

const SECRET = "bitnob-webhook-test-secret";
const CLIENT_ID = "86f1b05e-2e35-40bf-a85d-fd3de44d216b";
const CLIENT_SECRET = "bitnob-client-test-secret";
const PAYOUT_ID = "spec-po-1792595852";
const NG_BANK: Corridor = { country: "NG", currency: "NGN", payoutType: "bank" };
const GH_MOMO: Corridor = { country: "GH", currency: "GHS", payoutType: "mobile_money" };
const NG_RECIPIENT = {
  institutionCode: "058",
  accountNumber: "0123456789",
  accountName: "OKEY JOY CHIDIMMA",
};
const PAYOUT_PATH = `/api/payouts/${BY_REFERENCE.data.payout.id}`;

const QUOTE_REQUEST: QuoteRequest = {
  quoteId: "your-unique-ref-123",
  corridor: NG_BANK,
  source: { asset: "USDT", chain: "polygon" },
  amount: { side: "receive", minorUnits: 100_000n },
};

function orderRequest(
  quote: ProviderQuote,
  corridor = NG_BANK,
  recipient = NG_RECIPIENT,
): CreateOrderRequest {
  return { payoutId: PAYOUT_ID, quote, corridor, source: QUOTE_REQUEST.source, recipient, refundAddress: "" };
}

const EXCHANGES: RecordedExchange[] = [
  { method: "POST", path: "/api/payouts/quotes", status: 200, body: QUOTE },
  { method: "POST", path: "/api/payouts/QT2_21015643/initialize", status: 200, body: INITIALIZE },
  { method: "POST", path: "/api/payouts/QT2_21015643/finalize", status: 200, body: FINALIZE },
  { method: "GET", path: `/api/payouts/reference/${PAYOUT_ID}`, status: 200, body: BY_REFERENCE },
  { method: "GET", path: PAYOUT_PATH, status: 200, body: BY_REFERENCE },
  { method: "GET", path: "/api/payouts/reference/po_missing", status: 404, body: NOT_FOUND },
  { method: "GET", path: "/api/whoami", status: 200, body: WHOAMI },
  { method: "GET", path: "/api/balances/USDT", status: 200, body: BALANCE_USDT },
  { method: "GET", path: "/api/payouts/banks/NG", status: 200, body: BANKS_NG },
];

function setup(
  options: {
    exchanges?: RecordedExchange[];
    corridors?: Corridor[];
    environment?: "sandbox" | "production";
  } = {},
) {
  const alerts: ProviderAlert[] = [];
  const replay = replayFetch(options.exchanges ?? EXCHANGES);
  const adapter = createBitnobAdapter({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    webhookSecrets: [SECRET],
    expectedEnvironment: options.environment ?? "sandbox",
    corridors: options.corridors ?? [NG_BANK],
    nonce: () => "0123456789abcdef0123456789abcdef",
    deps: {
      fetch: replay.fetch,
      alert: (alert) => alerts.push(alert),
      now: () => new Date("2026-07-04T21:56:36Z"),
    },
  });
  return { adapter, alerts, replay };
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
    pii: [NG_RECIPIENT.accountNumber, NG_RECIPIENT.accountName],
    quotedAt: new Date(QUOTE.data.payout.trip.quote_at),
  };
});

describe("bitnob adapter", () => {
  it("signs client id, timestamp, nonce and the exact body sent", async () => {
    const { adapter, replay } = setup();
    await adapter.quote(QUOTE_REQUEST);
    const call = replay.calls[0]!;
    const timestamp = String(Math.floor(new Date("2026-07-04T21:56:36Z").getTime() / 1000));
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
      to_currency: "NGN",
      source: "offchain",
      country: "NG",
      settlement_amount: "1000",
      reference: "your-unique-ref-123",
    });
  });

  it("reads the quote in integer units", async () => {
    const quote = await setup().adapter.quote(QUOTE_REQUEST);
    expect(quote).toMatchObject({
      providerQuoteId: "QT2_21015643",
      sendUnits: 724_761n,
      receiveMinorUnits: 100_000n,
      rate: "1379.7651915597003702",
      expiresAt: new Date("2026-07-04T22:12:36.909609058Z"),
    });
  });

  it("refuses send-exactly quotes and corridors it was not configured for", async () => {
    await expect(
      setup().adapter.quote({ ...QUOTE_REQUEST, amount: { side: "send", units: 1_000_000n } }),
    ).rejects.toMatchObject({ kind: "not_supported" });
    await expect(setup({ corridors: [GH_MOMO] }).adapter.quote(QUOTE_REQUEST)).rejects.toMatchObject({
      kind: "not_supported",
    });
  });

  it("initializes with our payout id, then finalizes with an empty signed body", async () => {
    const { adapter, replay } = setup();
    const order = await adapter.createOrder(orderRequest(await adapter.quote(QUOTE_REQUEST)));
    const [, initialize, finalize] = replay.calls;
    expect(JSON.parse(initialize!.body)).toEqual({
      reference: PAYOUT_ID,
      beneficiary: {
        destination_type: "bank",
        country: "NG",
        account_name: "OKEY JOY CHIDIMMA",
        account_number: "0123456789",
        bank_code: "058",
      },
    });
    expect(finalize!.body).toBe("");
    expect(order).toEqual({
      providerOrderId: "01a15f0a-02ed-7859-9a5f-1c4c67e95389",
      reference: PAYOUT_ID,
      funding: { kind: "balance_debit", asset: "USDT", units: 739_331n },
    });
  });

  it("does not retry a finalize that fails", async () => {
    const { adapter, replay } = setup({
      exchanges: [
        EXCHANGES[0]!,
        EXCHANGES[1]!,
        { method: "POST", path: "/api/payouts/QT2_21015643/finalize", status: 503, body: {} },
      ],
    });
    const quote = await adapter.quote(QUOTE_REQUEST);
    await expect(adapter.createOrder(orderRequest(quote))).rejects.toMatchObject({ kind: "unavailable" });
    expect(replay.calls.map((call) => call.path)).toEqual([
      "/api/payouts/quotes",
      "/api/payouts/QT2_21015643/initialize",
      "/api/payouts/QT2_21015643/finalize",
    ]);
  });

  it("sends Ghana mobile money with the network and an international number", async () => {
    const { adapter, replay } = setup({ exchanges: EXCHANGES.slice(1, 3), corridors: [GH_MOMO] });
    const quote: ProviderQuote = {
      provider: "bitnob",
      providerQuoteId: "QT2_21015643",
      sendUnits: 724_761n,
      receiveMinorUnits: 5_727n,
      rate: "11.4543",
      fees: [],
      expiresAt: new Date("2026-07-04T22:12:36Z"),
    };
    const recipient = { institutionCode: "mtn", accountNumber: "0246838933", accountName: "Ama Mensah" };
    await adapter.createOrder(orderRequest(quote, GH_MOMO, recipient));
    expect(JSON.parse(replay.calls[0]!.body).beneficiary).toEqual({
      destination_type: "mobile_money",
      country: "GH",
      account_name: "Ama Mensah",
      account_number: "233246838933",
      network: "mtn",
    });
  });

  it("refuses a mobile number that belongs to another network before calling Bitnob", async () => {
    const { adapter, replay } = setup({ corridors: [GH_MOMO] });
    const quote = { providerQuoteId: "QT2_21015643" } as ProviderQuote;
    const recipient = {
      institutionCode: "vodafone",
      accountNumber: "233246838933",
      accountName: "Ama Mensah",
    };
    await expect(adapter.createOrder(orderRequest(quote, GH_MOMO, recipient))).rejects.toMatchObject({
      kind: "rejected",
    });
    expect(replay.calls).toHaveLength(0);
  });

  it("looks up MTN wallets and refuses Ghana banks and undocumented networks", async () => {
    const lookup = setup({
      exchanges: [
        {
          method: "GET",
          path: "/api/payouts/account-lookup?country=GH&type=mobile_money&bank_code=MTN&account_number=233246838933",
          status: 200,
          body: LOOKUP,
        },
      ],
      corridors: [GH_MOMO],
    });
    expect(
      await lookup.adapter.verifyAccount({
        country: "GH",
        institutionCode: "mtn",
        accountNumber: "0246838933",
      }),
    ).toEqual({ found: true, accountName: "CHIAMAKA JENNIFER EZEOBI" });
    await expect(
      lookup.adapter.verifyAccount({ country: "GH", institutionCode: "GH190100", accountNumber: "1" }),
    ).rejects.toMatchObject({ kind: "not_supported" });
    await expect(
      lookup.adapter.verifyAccount({
        country: "GH",
        institutionCode: "vodafone",
        accountNumber: "0201234567",
      }),
    ).rejects.toMatchObject({ kind: "not_supported" });
  });

  it("lists Ghana networks without a call and banks from the API", async () => {
    const ghana = setup({ corridors: [GH_MOMO] });
    expect(await ghana.adapter.institutions("GH")).toEqual([
      { code: "mtn", name: "MTN MoMo", type: "mobile_money" },
      { code: "vodafone", name: "Telecel Cash", type: "mobile_money" },
      { code: "airtel", name: "AirtelTigo Money", type: "mobile_money" },
    ]);
    expect(ghana.replay.calls).toHaveLength(0);
    expect(await setup().adapter.institutions("NG")).toEqual([
      { code: "110072", name: "78 FINANCE COMPANY LIMITED", type: "bank" },
      { code: "090629", name: "9JAPAY MICROFINANCE BANK", type: "bank" },
    ]);
  });

  it("maps every documented payout status and alerts on anything else", async () => {
    const expectations: Record<string, string> = {
      INITIATED: "awaiting_deposit",
      PENDING: "processing",
      PROCESSING: "processing",
      SUCCESS: "paid",
      FAILED: "failed",
    };
    for (const [status, normalized] of Object.entries(expectations)) {
      const body = { ...BY_REFERENCE, data: { payout: { ...BY_REFERENCE.data.payout, status } } };
      const { adapter } = setup({ exchanges: [{ method: "GET", path: PAYOUT_PATH, status: 200, body }] });
      const order = await adapter.getOrder({ providerOrderId: BY_REFERENCE.data.payout.id });
      expect(order?.status).toBe(normalized);
    }
    const body = { ...BY_REFERENCE, data: { payout: { ...BY_REFERENCE.data.payout, status: "QUOTE" } } };
    const { adapter, alerts } = setup({
      exchanges: [{ method: "GET", path: PAYOUT_PATH, status: 200, body }],
    });
    await expect(adapter.getOrder({ providerOrderId: BY_REFERENCE.data.payout.id })).rejects.toMatchObject({
      kind: "unmappable_status",
    });
    expect(alerts).toHaveLength(1);
  });

  it("keeps the settlement id as the payout reference", async () => {
    const order = await setup().adapter.getOrder({ reference: PAYOUT_ID });
    expect(order).toMatchObject({
      status: "paid",
      fiatReference: "sandbox_txn_bfc22197-4be8-4f42-b682-a2e73b027b02",
    });
  });

  it("dedupes webhooks on Bitnob's event id and maps an expired quote", () => {
    const { adapter } = setup();
    expect(adapter.parseWebhook(signed(WEBHOOK_SUCCESS)).eventId).toBe("d9c4758ub-5e93-4cdf-bb123-frt474865");
    const expired = adapter.parseWebhook(signed({ ...WEBHOOK_SUCCESS, event: "payouts.withdrawal.expired" }));
    expect(expired.order).toEqual({ status: "failed", code: "quote_expired", retryable: true });
  });

  it("reads the float in base units", async () => {
    expect(await setup().adapter.floatBalance("USDT")).toEqual({
      available: 5_017_200n,
      pending: 0n,
      total: 5_017_200n,
    });
  });

  it("is healthy only when the key is active in the expected environment", async () => {
    expect(await setup().adapter.health()).toEqual({ healthy: true });
    expect(await setup({ environment: "production" }).adapter.health()).toEqual({ healthy: false });
  });
});
