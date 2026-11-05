import { newId } from "../../../packages/db/src/ids.js";
import type { PayoutState } from "../../../packages/domain/payout-state.js";
import { transitionPayout } from "../../../packages/domain/transition.js";
import { ProviderError } from "../../../packages/providers/errors.js";
import type { InboundWebhook, OrderStatus, ProviderAdapter } from "../../../packages/providers/types.js";
import type { Unit } from "./db.js";
import type { Reply } from "./idempotency.js";

export interface WebhookDeps {
  unit: Unit;
  adapters: ProviderAdapter[];
}

function targetState(order: OrderStatus): PayoutState | null {
  switch (order.status) {
    case "awaiting_deposit":
      return null;
    case "deposit_received":
      return "with_provider";
    case "processing":
      return "paying_out";
    case "paid":
      return "settled";
    case "refunding":
      return "refunding";
    case "refunded":
      return "refunded";
    case "failed":
      return order.code === "deposit_expired" ? "expired" : "failed";
  }
}

const ok = (outcome: string): Reply => ({ status: 200, body: { outcome } });

export function createWebhookHandler({ unit, adapters }: WebhookDeps) {
  return async (providerId: string, webhook: InboundWebhook): Promise<Reply> => {
    const adapter = adapters.find((candidate) => candidate.id === providerId);
    if (!adapter) return { status: 404, body: { error: { code: "not_found", message: "No such provider." } } };

    let event;
    try {
      event = adapter.parseWebhook(webhook);
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      if (error.kind === "invalid_signature") return { status: 401, body: { error: { code: "unauthorized", message: "Bad signature." } } };
      // Acknowledged so the provider stops retrying an event we cannot act on; the adapter has already raised an alert.
      if (error.kind === "unmappable_status") return ok("ignored");
      return { status: 400, body: { error: { code: "invalid_request", message: "Unreadable webhook." } } };
    }

    const target = targetState(event.order);
    if (!target) return ok("ignored");

    return unit(async (tx) => {
      const payout = await tx.payout.findFirst({
        where: {
          provider: adapter.id,
          OR: [...(event.providerOrderId ? [{ providerOrderId: event.providerOrderId }] : []), ...(event.reference ? [{ id: event.reference }] : [])],
        },
      });
      // The provider can call back before our create-order transaction commits; a non-2xx makes it retry.
      if (!payout) return { status: 404, body: { error: { code: "not_found", message: "Unknown order." } } };

      const fresh = await tx.inbox.createMany({ data: [{ consumer: adapter.id, messageId: event.eventId }], skipDuplicates: true });
      if (fresh.count === 0) return ok("duplicate");

      const result = await transitionPayout(tx, { payoutId: payout.id, target, cause: `${adapter.id}_webhook`, detail: { event: event.eventId } });
      if (result.outcome === "illegal") {
        await tx.deadLetter.create({
          data: {
            id: newId("dlq"),
            queue: `${adapter.id}_webhook`,
            messageId: event.eventId,
            payload: { payoutId: payout.id, state: result.state, target },
            error: "transition_illegal",
            attempts: 1,
          },
        });
      }
      return ok(result.outcome);
    });
  };
}
