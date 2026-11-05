import { describe, expect, it } from "vitest";
import { hmac } from "../../webhooks/hmac";
import { describeAdapterContract } from "../contract/contract";
import { ProviderError } from "../errors";
import type { CreateOrderRequest, ProviderAlert, ProviderQuote, QuoteRequest } from "../types";
import { MOCK_SIGNATURE_HEADER, createMockProvider } from "./mock";

const SECRET = "mock-webhook-secret";
const RECIPIENT = { institutionCode: "058", accountNumber: "0123456789", accountName: "DARA OKONKWO" };

function quoteRequest(units: bigint): QuoteRequest {
  return {
    quoteId: "qt_mock",
    corridor: { country: "NG", currency: "NGN", payoutType: "bank" },
    source: { asset: "USDC", chain: "simulated" },
    amount: { side: "send", units },
  };
}

function orderRequest(quote: ProviderQuote, payoutId = "po_contract"): CreateOrderRequest {
  return {
    payoutId,
    quote,
    corridor: { country: "NG", currency: "NGN", payoutType: "bank" },
    source: { asset: "USDC", chain: "simulated" },
    recipient: RECIPIENT,
    refundAddress: "0xrefund",
  };
}

function setup() {
  const alerts: ProviderAlert[] = [];
  const mock = createMockProvider({ deps: { alert: (alert) => alerts.push(alert) }, webhookSecret: SECRET });
  return { ...mock, alerts };
}

describeAdapterContract("mock", async () => {
  const { adapter, control, alerts } = setup();
  const order = await adapter.createOrder(
    orderRequest(await adapter.quote(quoteRequest(50_000_000n)), "po_hook"),
  );
  control.deposit(order.providerOrderId);
  const unmappableBody = JSON.stringify({
    event_id: "evt_x",
    order_id: "mo_x",
    reference: "po_x",
    status: "teleported",
  });
  return {
    adapter,
    alerts,
    quoteRequest: quoteRequest(50_000_000n),
    orderRequest: (quote) => orderRequest(quote),
    unknownReference: "po_missing",
    validWebhook: control.webhook(order.providerOrderId, "evt_1"),
    expectedWebhookStatus: "deposit_received",
    unmappableWebhook: {
      headers: { [MOCK_SIGNATURE_HEADER]: hmac("sha256", SECRET, unmappableBody, "hex") },
      rawBody: unmappableBody,
    },
    pii: [RECIPIENT.accountNumber, RECIPIENT.accountName],
  };
});

describe("mock provider", () => {
  it("reproduces the canonical 50 USDC NGN fixture quote", async () => {
    const { adapter } = setup();
    const quote = await adapter.quote(quoteRequest(50_000_000n));
    expect(quote.receiveMinorUnits).toBe(6_881_600n);
    expect(quote.rate).toBe("1376.32");
    expect(quote.fees).toEqual([
      { kind: "provider", amount: 25_000n, unit: "NGN" },
      { kind: "network", amount: 9_400n, unit: "NGN" },
    ]);
  });

  it("quotes receive-exactly with a send amount that covers the target", async () => {
    const { adapter } = setup();
    const quote = await adapter.quote({
      ...quoteRequest(0n),
      amount: { side: "receive", minorUnits: 3_000_000n },
    });
    expect(quote.receiveMinorUnits >= 3_000_000n).toBe(true);
    const oneLess = await adapter.quote(quoteRequest(quote.sendUnits - 1n));
    expect(oneLess.receiveMinorUnits < 3_000_000n).toBe(true);
  });

  it("refuses corridors without a canonical rate", async () => {
    const { adapter } = setup();
    const request = {
      ...quoteRequest(1_000_000n),
      corridor: { country: "KE", currency: "KES", payoutType: "bank" },
    } as const;
    await expect(adapter.quote(request)).rejects.toMatchObject({ kind: "not_supported" });
  });

  async function runToEnd(units: bigint, payoutId: string) {
    const { adapter, control } = setup();
    const order = await adapter.createOrder(orderRequest(await adapter.quote(quoteRequest(units)), payoutId));
    control.deposit(order.providerOrderId);
    let snapshot = control.advance(order.providerOrderId);
    for (let i = 0; i < 5; i++) snapshot = control.advance(order.providerOrderId);
    return snapshot;
  }

  it(".00 settles with the fixture bank reference", async () => {
    expect(await runToEnd(50_000_000n, "po_settle")).toMatchObject({
      status: "paid",
      fiatReference: "000013251029140213",
    });
  });

  it(".01 fails", async () => {
    expect(await runToEnd(50_010_000n, "po_fail")).toMatchObject({ status: "failed", retryable: false });
  });

  it(".02 refunds with a refund hash", async () => {
    const snapshot = await runToEnd(50_020_000n, "po_refund");
    expect(snapshot.status).toBe("refunded");
  });

  it(".03 times out but the order exists for re-query", async () => {
    const { adapter } = setup();
    const quote = await adapter.quote(quoteRequest(50_030_000n));
    await expect(adapter.createOrder(orderRequest(quote, "po_t1"))).rejects.toBeInstanceOf(ProviderError);
    expect(await adapter.getOrder({ reference: "po_t1" })).toMatchObject({ status: "awaiting_deposit" });
  });

  it(".04 times out and the order is confirmed absent", async () => {
    const { adapter } = setup();
    const quote = await adapter.quote(quoteRequest(50_040_000n));
    await expect(adapter.createOrder(orderRequest(quote, "po_t2"))).rejects.toMatchObject({
      kind: "timeout",
    });
    expect(await adapter.getOrder({ reference: "po_t2" })).toBeNull();
  });

  it("returns the existing order when asked to create the same payout twice", async () => {
    const { adapter } = setup();
    const quote = await adapter.quote(quoteRequest(50_000_000n));
    const first = await adapter.createOrder(orderRequest(quote, "po_twice"));
    const second = await adapter.createOrder(orderRequest(quote, "po_twice"));
    expect(second.providerOrderId).toBe(first.providerOrderId);
  });

  it("verifies only the fixture account", async () => {
    const { adapter } = setup();
    expect(
      await adapter.verifyAccount({ country: "NG", institutionCode: "058", accountNumber: "0123456789" }),
    ).toEqual({
      found: true,
      accountName: "DARA OKONKWO",
    });
    expect(
      await adapter.verifyAccount({ country: "NG", institutionCode: "058", accountNumber: "1111111111" }),
    ).toEqual({
      found: false,
    });
  });
});
