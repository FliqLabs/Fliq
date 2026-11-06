import { describe, expect, it } from "vitest";
import { ProviderError } from "../errors";
import type {
  CreateOrderRequest,
  InboundWebhook,
  OrderStatus,
  ProviderAdapter,
  ProviderAlert,
  ProviderQuote,
  QuoteRequest,
} from "../types";

export type ContractContext = {
  adapter: ProviderAdapter;
  alerts: ProviderAlert[];
  quoteRequest: QuoteRequest;
  orderRequest(quote: ProviderQuote): CreateOrderRequest;
  unknownReference: string;
  validWebhook: InboundWebhook;
  expectedWebhookStatus: OrderStatus["status"];
  unmappableWebhook: InboundWebhook;
  pii: string[];
  // Documented examples carry historical timestamps, so the quote is judged against the time it was issued.
  quotedAt?: Date;
};

const NORMALIZED_STATUSES: ReadonlySet<string> = new Set([
  "awaiting_deposit",
  "deposit_received",
  "processing",
  "paid",
  "refunding",
  "refunded",
  "failed",
]);

// Every adapter runs this suite on recorded fixtures, with no network and no keys (ARCH §9, §17.3).
export function describeAdapterContract(
  name: string,
  setup: () => Promise<ContractContext> | ContractContext,
) {
  describe(`${name} adapter contract`, () => {
    it("declares usable capabilities", async () => {
      const { adapter } = await setup();
      const capabilities = adapter.capabilities();
      expect(capabilities.provider).toBe(adapter.id);
      expect(capabilities.corridors.length).toBeGreaterThan(0);
      expect(capabilities.sources.length).toBeGreaterThan(0);
      for (const limits of Object.values(capabilities.limits)) {
        expect(limits.min <= limits.max).toBe(true);
      }
    });

    it("quotes in integer units with an expiry in the future", async () => {
      const { adapter, quoteRequest, quotedAt } = await setup();
      const quote = await adapter.quote(quoteRequest);
      expect(quote.provider).toBe(adapter.id);
      expect(typeof quote.sendUnits).toBe("bigint");
      expect(typeof quote.receiveMinorUnits).toBe("bigint");
      expect(quote.sendUnits > 0n).toBe(true);
      expect(quote.receiveMinorUnits > 0n).toBe(true);
      expect(quote.rate).toMatch(/^\d+(\.\d+)?$/);
      for (const fee of quote.fees) expect(typeof fee.amount).toBe("bigint");
      expect(quote.expiresAt.getTime()).toBeGreaterThan((quotedAt ?? new Date()).getTime());
    });

    it("creates an order carrying our payout id and finds it by that reference", async () => {
      const { adapter, quoteRequest, orderRequest } = await setup();
      const request = orderRequest(await adapter.quote(quoteRequest));
      const order = await adapter.createOrder(request);
      expect(order.reference).toBe(request.payoutId);
      expect(order.providerOrderId).not.toBe("");
      expect(order.funding.units > 0n).toBe(true);
      const byReference = await adapter.getOrder({ reference: request.payoutId });
      expect(byReference?.providerOrderId).toBe(order.providerOrderId);
      const byId = await adapter.getOrder({ providerOrderId: order.providerOrderId });
      expect(NORMALIZED_STATUSES.has(byId?.status ?? "")).toBe(true);
    });

    it("returns null for an order that does not exist", async () => {
      const { adapter, unknownReference } = await setup();
      expect(await adapter.getOrder({ reference: unknownReference })).toBeNull();
    });

    it("maps a signed webhook to a normalized status", async () => {
      const { adapter, validWebhook, expectedWebhookStatus } = await setup();
      const event = adapter.parseWebhook(validWebhook);
      expect(event.eventId).not.toBe("");
      expect(event.order.status).toBe(expectedWebhookStatus);
    });

    it("rejects and alerts on a tampered webhook without changing anything", async () => {
      const { adapter, alerts, validWebhook } = await setup();
      const tampered = { ...validWebhook, rawBody: validWebhook.rawBody.replace(/.$/, " ") };
      expect(() => adapter.parseWebhook(tampered)).toThrowError(
        expect.objectContaining({ kind: "invalid_signature" }) as Error,
      );
      expect(alerts.map((alert) => alert.kind)).toContain("invalid_signature");
    });

    it("alerts instead of guessing on a status it cannot map", async () => {
      const { adapter, alerts, unmappableWebhook } = await setup();
      expect(() => adapter.parseWebhook(unmappableWebhook)).toThrowError(
        expect.objectContaining({ kind: "unmappable_status" }) as Error,
      );
      expect(alerts.map((alert) => alert.kind)).toContain("unmappable_status");
    });

    it("never puts recipient details in errors or alerts", async () => {
      const { adapter, alerts, pii, unmappableWebhook } = await setup();
      const messages: string[] = [];
      try {
        adapter.parseWebhook(unmappableWebhook);
      } catch (error) {
        if (error instanceof ProviderError) messages.push(error.message);
      }
      messages.push(...alerts.map((alert) => alert.detail));
      for (const value of pii) for (const message of messages) expect(message).not.toContain(value);
    });
  });
}
