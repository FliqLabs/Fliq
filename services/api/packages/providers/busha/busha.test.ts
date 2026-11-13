import { describe, expect, it } from "vitest";
import { hmac } from "../../webhooks/hmac";
import { describeAdapterContract } from "../contract/contract";
import { replayFetch, type RecordedExchange } from "../contract/replay";
import { toDecimalString } from "../money";
import type { CreateOrderRequest, ProviderAlert, ProviderQuote, QuoteRequest } from "../types";
import { BUSHA_SIGNATURE_HEADER, createBushaAdapter, type BushaOptions } from "./busha";
import {
  BANKS_NGN,
  COUNTRIES_NG,
  CURRENCY_USDC,
  HEALTH,
  PUBLIC_QUOTE,
  PUBLIC_QUOTED_AT,
  PUBLIC_QUOTE_KES_TARGET,
  QUOTE,
  RECIPIENT_NGN,
  RESOLVED_ACCOUNT,
  TRANSFER,
  WEBHOOK_DELIVERED,
  WEBHOOK_NOT_DELIVERED,
} from "./busha.fixtures";

const SECRET = "busha-test-secret";
const PAYOUT_ID = "po_01JC2X7Q9Z8K4M3N5P6R7S8T9V";
const RECIPIENT = { institutionCode: "000014", accountNumber: "1234567890", accountName: "John Doe" };
const CURRENCIES_PATH = "/v1/currencies/USDC";
const PUBLIC_QUOTES_PATH = "/v1/quotes/unauthenticated";

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
  { method: "GET", path: CURRENCIES_PATH, status: 200, body: CURRENCY_USDC },
  { method: "POST", path: PUBLIC_QUOTES_PATH, status: 201, body: PUBLIC_QUOTE },
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
  { method: "GET", path: "/v1/countries?country=NG", status: 200, body: COUNTRIES_NG },
];

function signed(body: unknown) {
  const rawBody = JSON.stringify(body);
  return { headers: { [BUSHA_SIGNATURE_HEADER]: hmac("sha256", SECRET, rawBody, "base64") }, rawBody };
}

type Setup = { exchanges?: RecordedExchange[]; clock?: { time: number } } & Partial<
  Omit<BushaOptions, "deps" | "webhookSecrets">
>;

function setup({ exchanges = EXCHANGES, clock, ...overrides }: Setup = {}) {
  const alerts: ProviderAlert[] = [];
  const replay = replayFetch(exchanges);
  const adapter = createBushaAdapter({
    secretKey: "test-secret-key",
    webhookSecrets: [SECRET],
    environment: "production",
    allowProduction: true,
    ...overrides,
    deps: {
      fetch: replay.fetch,
      alert: (alert) => alerts.push(alert),
      ...(clock ? { now: () => new Date(clock.time) } : {}),
    },
  });
  const calls = () => replay.calls.filter((call) => call.path !== CURRENCIES_PATH);
  return { adapter, alerts, replay, calls };
}

function withResponse(path: string, method: string, body: unknown, status = 200): RecordedExchange[] {
  return [{ method, path, status, body }, ...EXCHANGES.filter((exchange) => exchange.path !== path)];
}

function without(path: string): RecordedExchange[] {
  return EXCHANGES.filter((exchange) => exchange.path !== path);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const withHash = (data: object) => ({ ...data, pay_in: { address: "x", blockchain_hash: "5Kd3hash" } });

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
    unmappableWebhook: signed({ ...WEBHOOK_DELIVERED, event: "transfer.under_review" }),
    pii: [RECIPIENT.accountNumber, RECIPIENT.accountName],
    quotedAt: PUBLIC_QUOTED_AT,
  };
});

describe("busha adapter", () => {
  describe("capabilities", () => {
    it("funds only directly, never through a 1Click hop, and requires 2 USDC", () => {
      const capabilities = setup().adapter.capabilities();
      expect(capabilities.funding).toEqual({ direct: true, hop: false });
      expect(capabilities.sandbox).toBe(false);
      expect(capabilities.limits.NGN).toEqual({ side: "send", min: 2_000_000n, max: 1_000_000_000_000n });
      expect(capabilities.limits.KES?.min).toBe(2_000_000n);
    });

    it("starts from Solana in production and Base in the sandbox", () => {
      expect(setup({ exchanges: without(CURRENCIES_PATH) }).adapter.capabilities().sources).toEqual([
        { asset: "USDC", chain: "solana" },
      ]);
      const sandbox = setup({ exchanges: without(CURRENCIES_PATH), environment: "sandbox" }).adapter;
      expect(sandbox.capabilities().sources).toEqual([{ asset: "USDC", chain: "base" }]);
      expect(sandbox.capabilities().sandbox).toBe(true);
    });

    it("keeps only the live networks where Busha sells USDC for fiat", async () => {
      const live = {
        ...CURRENCY_USDC,
        data: {
          ...CURRENCY_USDC.data,
          supported_networks: CURRENCY_USDC.data.supported_networks.map((network) =>
            network.network === "BASE" ? { ...network, is_ramp_sell_supported: true } : network,
          ),
        },
      };
      const { adapter } = setup({ exchanges: withResponse(CURRENCIES_PATH, "GET", live) });
      await settle();
      expect(adapter.capabilities().sources).toEqual([
        { asset: "USDC", chain: "solana" },
        { asset: "USDC", chain: "base" },
      ]);
    });

    it("keeps the default networks when the live list fails, and asks again only after an hour", async () => {
      const clock = { time: 0 };
      const { adapter, replay } = setup({
        exchanges: withResponse(CURRENCIES_PATH, "GET", { status: "error" }, 400),
        clock,
      });
      await settle();
      adapter.capabilities();
      expect(adapter.capabilities().sources).toEqual([{ asset: "USDC", chain: "solana" }]);
      clock.time = 60 * 60 * 1000;
      adapter.capabilities();
      await settle();
      expect(replay.calls.filter((call) => call.path === CURRENCIES_PATH)).toHaveLength(2);
    });
  });

  describe("quotes", () => {
    it("prices fan-out quotes on the public endpoint without the secret key", async () => {
      const { adapter, calls } = setup();
      const quote = await adapter.quote(QUOTE_REQUEST);
      expect(calls()[0]?.path).toBe(PUBLIC_QUOTES_PATH);
      expect(calls()[0]?.headers.Authorization).toBeUndefined();
      expect(JSON.parse(calls()[0]?.body ?? "{}")).toEqual({
        source_currency: "USDC",
        target_currency: "NGN",
        source_amount: "100",
        pay_in: { type: "address", network: "SOL" },
      });
      expect(quote.sendUnits).toBe(100_000_000n);
      expect(quote.rate).toBe("1372.53");
      expect(quote.expiresAt.toISOString()).toBe("2026-11-10T08:02:13.130Z");
    });

    it("deducts the published payout fee because a public quote has no recipient fees", async () => {
      const { adapter } = setup();
      const quote = await adapter.quote(QUOTE_REQUEST);
      expect(quote.receiveMinorUnits).toBe(13_725_300n - 10_750n);
      expect(quote.fees).toEqual([{ kind: "provider", amount: 10_750n, unit: "NGN" }]);
    });

    it("keeps Busha's own fees when a quote carries them", async () => {
      const { adapter } = setup({ exchanges: withResponse(PUBLIC_QUOTES_PATH, "POST", QUOTE, 201) });
      const quote = await adapter.quote(QUOTE_REQUEST);
      expect(quote.receiveMinorUnits).toBe(16_887_600n);
      expect(quote.fees).toEqual([{ kind: "provider", amount: 20_000n, unit: "NGN" }]);
    });

    it("asks for the target plus the payout fee and rounds an 8-decimal source amount up", async () => {
      const { adapter, calls } = setup({
        exchanges: withResponse(PUBLIC_QUOTES_PATH, "POST", PUBLIC_QUOTE_KES_TARGET, 201),
      });
      const quote = await adapter.quote({
        ...QUOTE_REQUEST,
        corridor: { country: "KE", currency: "KES", payoutType: "mobile_money" },
        amount: { side: "receive", minorUnits: 467_000n },
      });
      const body = JSON.parse(calls()[0]?.body ?? "{}") as { target_amount?: string; source_amount?: string };
      expect(body.target_amount).toBe(toDecimalString(500_000n, 2));
      expect(body.source_amount).toBeUndefined();
      expect(quote.sendUnits).toBe(38_747_676n);
      expect(quote.receiveMinorUnits).toBe(467_000n);
    });

    it("reuses an identical quote for 10 seconds to stay within Busha's quote limit", async () => {
      const clock = { time: 0 };
      const { adapter, calls } = setup({ clock });
      const publicCalls = () => calls().filter((call) => call.path === PUBLIC_QUOTES_PATH).length;
      const first = await adapter.quote(QUOTE_REQUEST);
      clock.time = 9_999;
      expect(await adapter.quote({ ...QUOTE_REQUEST, quoteId: "qt_other" })).toBe(first);
      expect(publicCalls()).toBe(1);
      await adapter.quote({ ...QUOTE_REQUEST, amount: { side: "send", units: 50_000_000n } });
      expect(publicCalls()).toBe(2);
      clock.time = 10_000;
      await adapter.quote(QUOTE_REQUEST);
      expect(publicCalls()).toBe(3);
    });

    it("does not keep a failed quote", async () => {
      const { adapter, calls } = setup({
        exchanges: withResponse(PUBLIC_QUOTES_PATH, "POST", { status: "error" }, 400),
      });
      await expect(adapter.quote(QUOTE_REQUEST)).rejects.toMatchObject({ kind: "rejected" });
      await expect(adapter.quote(QUOTE_REQUEST)).rejects.toMatchObject({ kind: "rejected" });
      expect(calls().filter((call) => call.path === PUBLIC_QUOTES_PATH)).toHaveLength(2);
    });

    it("refuses corridors, assets and chains it does not support", async () => {
      const { adapter } = setup();
      const ghana: QuoteRequest = {
        ...QUOTE_REQUEST,
        corridor: { country: "GH", currency: "GHS", payoutType: "bank" },
      };
      const usdt: QuoteRequest = { ...QUOTE_REQUEST, source: { asset: "USDT", chain: "solana" } };
      const polygon: QuoteRequest = { ...QUOTE_REQUEST, source: { asset: "USDC", chain: "polygon" } };
      await expect(adapter.quote(ghana)).rejects.toMatchObject({ kind: "not_supported" });
      await expect(adapter.quote(usdt)).rejects.toMatchObject({ kind: "not_supported" });
      await expect(adapter.quote(polygon)).rejects.toMatchObject({ kind: "not_supported" });
      const sandbox = setup({ exchanges: without(CURRENCIES_PATH), environment: "sandbox" }).adapter;
      await expect(sandbox.quote(QUOTE_REQUEST)).rejects.toMatchObject({ kind: "not_supported" });
    });

    it("quotes Base in the sandbox", async () => {
      const { adapter, calls } = setup({ exchanges: without(CURRENCIES_PATH), environment: "sandbox" });
      await adapter.quote({ ...QUOTE_REQUEST, source: { asset: "USDC", chain: "base" } });
      expect(JSON.parse(calls()[0]?.body ?? "{}").pay_in).toEqual({ type: "address", network: "BASE" });
    });
  });

  describe("orders", () => {
    it("creates a one-time recipient, a firm quote with our reference, then the transfer", async () => {
      const { adapter, calls } = setup();
      const quote = await adapter.quote(QUOTE_REQUEST);
      const order = await adapter.createOrder(orderRequest(quote));
      const orderCalls = calls().slice(1);
      expect(orderCalls.map((call) => `${call.method} ${call.path}`)).toEqual([
        "GET /v1/banks?currency=NGN",
        "POST /v1/recipients",
        "POST /v1/quotes",
        "POST /v1/transfers",
      ]);
      expect(orderCalls[2]?.headers.Authorization).toBe("Bearer test-secret-key");
      expect(JSON.parse(orderCalls[1]?.body ?? "{}")).toMatchObject({
        type: "ngn_bank",
        bank_name: "Access Bank",
        bank_code: "000014",
        one_time: true,
      });
      expect(JSON.parse(orderCalls[2]?.body ?? "{}")).toMatchObject({
        reference: PAYOUT_ID,
        reversal_policy: "conversion_only",
        pay_out: { type: "bank_transfer", recipient_id: RECIPIENT_NGN.data.id },
      });
      expect(JSON.parse(orderCalls[3]?.body ?? "{}")).toEqual({ quote_id: QUOTE.data.id });
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

    it("refuses production payouts unless they are explicitly allowed", async () => {
      const { adapter, calls } = setup({ allowProduction: false });
      const quote = await adapter.quote(QUOTE_REQUEST);
      await expect(adapter.createOrder(orderRequest(quote))).rejects.toMatchObject({ kind: "not_supported" });
      expect(calls()).toHaveLength(1);
    });

    it("allows sandbox payouts without the production switch", async () => {
      const { adapter } = setup({
        exchanges: without(CURRENCIES_PATH),
        environment: "sandbox",
        allowProduction: false,
      });
      const base = { asset: "USDC", chain: "base" } as const;
      const quote = await adapter.quote({ ...QUOTE_REQUEST, source: base });
      const order = await adapter.createOrder({ ...orderRequest(quote), source: base });
      expect(order.providerOrderId).toBe(TRANSFER.data.id);
    });

    it("accepts a firm quote up to 30 basis points below the route and stops beyond that", async () => {
      const firm = 16_887_600n;
      const worst = (firm * 10_000n) / 9_970n;
      const accepted = setup();
      const quote = await accepted.adapter.quote(QUOTE_REQUEST);
      await expect(
        accepted.adapter.createOrder(orderRequest({ ...quote, receiveMinorUnits: worst })),
      ).resolves.toMatchObject({ providerOrderId: TRANSFER.data.id });
      const refused = setup();
      await expect(
        refused.adapter.createOrder(orderRequest({ ...quote, receiveMinorUnits: worst + 1n })),
      ).rejects.toMatchObject({ kind: "rejected" });
      expect(refused.calls().some((call) => call.path === "/v1/transfers")).toBe(false);
    });

    it("registers M-Pesa recipients with an international phone number", async () => {
      const noFees = { ...QUOTE, data: { ...QUOTE.data, fees: [] } };
      const { adapter, calls } = setup({ exchanges: withResponse("/v1/quotes", "POST", noFees, 201) });
      const quote = await adapter.quote(QUOTE_REQUEST);
      await adapter.createOrder({
        ...orderRequest({ ...quote, receiveMinorUnits: 0n }),
        corridor: { country: "KE", currency: "KES", payoutType: "mobile_money" },
        recipient: { institutionCode: "MPESA", accountNumber: "0712345678", accountName: "John Doe" },
      });
      const recipient = calls().find((call) => call.path === "/v1/recipients");
      expect(JSON.parse(recipient?.body ?? "{}")).toMatchObject({
        type: "mpesa_mobile_money",
        currency: "KES",
        country_code: "KE",
        phone_number: "+254712345678",
      });
      expect(calls().some((call) => call.path.startsWith("/v1/banks"))).toBe(false);
    });

    it("does not report a transfer absent when the reference filter returns someone else's", async () => {
      const other = withResponse(`/v1/transfers?reference=${PAYOUT_ID}`, "GET", list([TRANSFER.data]));
      const { adapter } = setup({ exchanges: other });
      await expect(adapter.getOrder({ reference: PAYOUT_ID })).rejects.toMatchObject({ kind: "unavailable" });
    });

    it("returns null for an unknown transfer id", async () => {
      const { adapter } = setup();
      expect(await adapter.getOrder({ providerOrderId: "TRF_unknown" })).toBeNull();
    });
  });

  describe("statuses", () => {
    it("maps a delivered payout to paid with the bank session id", () => {
      const { adapter } = setup();
      const event = adapter.parseWebhook(signed(WEBHOOK_DELIVERED));
      expect(event).toEqual({
        eventId: `${WEBHOOK_DELIVERED.data.id}:transfer.funds_delivered`,
        providerOrderId: WEBHOOK_DELIVERED.data.id,
        order: { status: "paid", fiatReference: WEBHOOK_DELIVERED.data.pay_out.session_id },
      });
    });

    it("maps completed to paid only when the transfer paid out fiat", () => {
      const { adapter } = setup();
      const payout = { ...WEBHOOK_DELIVERED, event: "transfer.completed" };
      expect(adapter.parseWebhook(signed(payout)).order).toEqual({
        status: "paid",
        fiatReference: WEBHOOK_DELIVERED.data.pay_out.session_id,
      });
      const { pay_out: _payOut, stages: _stages, ...sale } = WEBHOOK_DELIVERED.data;
      const balanceSale = {
        ...WEBHOOK_DELIVERED,
        event: "transfer.completed",
        data: { ...sale, pay_out: { type: "balance" } },
      };
      expect(adapter.parseWebhook(signed(balanceSale)).order).toEqual({ status: "processing" });
    });

    it("maps an undelivered payout to refunding", () => {
      const { adapter } = setup();
      expect(adapter.parseWebhook(signed(WEBHOOK_NOT_DELIVERED)).order).toEqual({ status: "refunding" });
    });

    it("maps a refund into the Busha balance to refunding and alerts once without recipient details", async () => {
      const refunded = { ...WEBHOOK_NOT_DELIVERED.data, status: "funds_refunded" };
      const { adapter, alerts } = setup({
        exchanges: withResponse(`/v1/transfers/${refunded.id}`, "GET", { status: "success", data: refunded }),
      });
      const event = adapter.parseWebhook(
        signed({ ...WEBHOOK_NOT_DELIVERED, event: "transfer.funds_refunded", data: refunded }),
      );
      expect(event.order).toEqual({ status: "refunding" });
      expect(await adapter.getOrder({ providerOrderId: refunded.id })).toMatchObject({ status: "refunding" });
      const refundAlerts = alerts.filter((alert) => alert.kind === "custodial_refund");
      expect(refundAlerts).toEqual([
        {
          provider: "busha",
          kind: "custodial_refund",
          detail: `transfer ${refunded.id} refunded into the Busha balance`,
        },
      ]);
      const pii = Object.values(WEBHOOK_NOT_DELIVERED.data.pay_out.recipient_details);
      for (const value of pii) expect(refundAlerts[0]?.detail).not.toContain(value);
    });

    it("expires a cancelled or failed transfer that never received a deposit", () => {
      const { adapter } = setup();
      const expired = { status: "failed", code: "deposit_expired", retryable: true };
      const cancelled = { ...WEBHOOK_NOT_DELIVERED, event: "transfer.cancelled" };
      expect(adapter.parseWebhook(signed(cancelled)).order).toEqual(expired);
      const failed = { ...WEBHOOK_NOT_DELIVERED, event: "transfer.failed" };
      expect(adapter.parseWebhook(signed(failed)).order).toEqual(expired);
    });

    it("treats a cancelled or failed transfer that received a deposit as refunding", () => {
      const { adapter } = setup();
      for (const event of ["transfer.cancelled", "transfer.failed"]) {
        const body = { ...WEBHOOK_NOT_DELIVERED, event, data: withHash(WEBHOOK_NOT_DELIVERED.data) };
        expect(adapter.parseWebhook(signed(body)).order).toEqual({ status: "refunding" });
      }
    });
  });

  describe("accounts", () => {
    it("verifies Nigerian bank accounts by name", async () => {
      const { adapter, calls } = setup();
      const result = await adapter.verifyAccount({
        institutionCode: "000013",
        accountNumber: "0123456789",
        country: "NG",
      });
      expect(result).toEqual({ found: true, accountName: "John Doe" });
      expect(JSON.parse(calls()[0]?.body ?? "{}")).toMatchObject({
        channel: "bank_transfer",
        currency_id: "NGN",
      });
    });

    it("accepts a well-formed M-Pesa number without a name and rejects anything else", async () => {
      const { adapter, calls } = setup();
      const check = (accountNumber: string, institutionCode = "MPESA") =>
        adapter.verifyAccount({ institutionCode, accountNumber, country: "KE" });
      expect(await check("0712345678")).toEqual({ found: true, accountName: null });
      expect(await check("+254 112 345 678")).toEqual({ found: true, accountName: null });
      expect(await check("0812345678")).toEqual({ found: false });
      expect(await check("07123456")).toEqual({ found: false });
      expect(await check("0712345678", "AIRTEL")).toEqual({ found: false });
      expect(calls()).toHaveLength(0);
    });

    it("refuses other countries", async () => {
      const { adapter } = setup();
      await expect(
        adapter.verifyAccount({ institutionCode: "GCB", accountNumber: "0241234567", country: "GH" }),
      ).rejects.toMatchObject({ kind: "not_supported" });
    });

    it("treats a rejected account lookup as not found", async () => {
      const { adapter } = setup({
        exchanges: withResponse("/v1/recipients/resolve-bank-account", "POST", { status: "error" }, 400),
      });
      expect(
        await adapter.verifyAccount({
          institutionCode: "000013",
          accountNumber: "0123456789",
          country: "NG",
        }),
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
  });

  describe("public quotes mode", () => {
    const keyless = () => setup({ secretKey: undefined, publicQuotes: true, allowProduction: false });

    it("needs a key unless public quotes mode is on", () => {
      expect(() => setup({ secretKey: undefined })).toThrow(/secret key/);
      expect(() => setup({ secretKey: "  " })).toThrow(/secret key/);
    });

    it("quotes from the public endpoint and is never a payout route", async () => {
      const { adapter, calls } = keyless();
      expect(adapter.capabilities().funding).toEqual({ direct: false, hop: false });
      const quote = await adapter.quote(QUOTE_REQUEST);
      expect(quote.receiveMinorUnits).toBe(13_725_300n - 10_750n);
      expect(calls()[0]?.headers.Authorization).toBeUndefined();
    });

    it("refuses orders, lookups and account checks", async () => {
      const { adapter, calls } = keyless();
      const quote = await adapter.quote(QUOTE_REQUEST);
      await expect(adapter.createOrder(orderRequest(quote))).rejects.toMatchObject({ kind: "not_supported" });
      await expect(adapter.getOrder({ providerOrderId: TRANSFER.data.id })).rejects.toMatchObject({
        kind: "not_supported",
      });
      await expect(adapter.getOrder({ reference: PAYOUT_ID })).rejects.toMatchObject({
        kind: "not_supported",
      });
      await expect(
        adapter.verifyAccount({ institutionCode: "000013", accountNumber: "0123456789", country: "NG" }),
      ).rejects.toMatchObject({ kind: "not_supported" });
      expect(calls()).toHaveLength(1);
    });

    it("still lists institutions", async () => {
      const { adapter, calls } = keyless();
      expect(await adapter.institutions("KE")).toEqual([
        { code: "MPESA", name: "M-Pesa", type: "mobile_money" },
      ]);
      expect(await adapter.institutions("NG")).toHaveLength(BANKS_NGN.data.length);
      expect(calls()[0]?.headers.Authorization).toBeUndefined();
    });
  });

  describe("health", () => {
    it("reports health from the health endpoint", async () => {
      const { adapter, calls } = setup();
      expect(await adapter.health()).toEqual({ healthy: true });
      expect(calls().map((call) => call.path)).toEqual(["/health"]);
    });

    it("falls back to the countries endpoint when the health endpoint fails", async () => {
      const { adapter } = setup({ exchanges: withResponse("/health", "GET", { status: "error" }, 500) });
      expect(await adapter.health()).toEqual({ healthy: true });
    });
  });
});
