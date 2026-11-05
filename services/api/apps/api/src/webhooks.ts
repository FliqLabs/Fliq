import { encrypt } from "../../../packages/db/src/crypto.js";
import { newId } from "../../../packages/db/src/ids.js";
import type { PayoutState } from "../../../packages/domain/payout-state.js";
import { transitionPayout } from "../../../packages/domain/transition.js";
import { ProviderError } from "../../../packages/providers/errors.js";
import type {
  InboundWebhook,
  OrderStatus,
  ProviderAdapter,
  WebhookEvent,
} from "../../../packages/providers/types.js";
import type { Db, Unit } from "./db.js";
import type { Reply } from "./idempotency.js";

export interface WebhookDeps {
  unit: Unit;
  adapters: ProviderAdapter[];
  dataKey: Buffer;
}

type Kept = { providerEventId?: string; providerOrderId?: string; signatureValid: boolean };

// ARCH §9.4: every delivery is kept for audit and replay, bad signatures included. The body is encrypted
// because providers echo account numbers and names. A retried delivery keeps its first row.
function keep(tx: Db, dataKey: Buffer, provider: string, webhook: InboundWebhook, kept: Kept) {
  return tx.inboundEvent.createMany({
    data: [
      {
        id: newId("ine"),
        provider,
        providerEventId: kept.providerEventId ?? null,
        providerOrderId: kept.providerOrderId ?? null,
        signatureValid: kept.signatureValid,
        bodyCipher: encrypt(webhook.rawBody, dataKey),
      },
    ],
    skipDuplicates: true,
  });
}

// What the receipt and the failure reason read back from the transition's event.
function evidence(order: OrderStatus) {
  if (order.status === "paid" && order.fiatReference) return { fiat_reference: order.fiatReference };
  if (order.status === "refunded" && order.refundTxHash) return { refund_tx_hash: order.refundTxHash };
  if (order.status === "failed") return { failure_code: order.code };
  return {};
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

export function createWebhookHandler({ unit, adapters, dataKey }: WebhookDeps) {
  return async (providerId: string, webhook: InboundWebhook): Promise<Reply> => {
    const adapter = adapters.find((candidate) => candidate.id === providerId);
    if (!adapter) return { status: 404, body: { error: { code: "not_found", message: "No such provider." } } };

    let event: WebhookEvent;
    try {
      event = adapter.parseWebhook(webhook);
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      // Adapters check the signature before reading the body, so any other failure was signed by the provider.
      const signatureValid = error.kind !== "invalid_signature";
      await unit((tx) => keep(tx, dataKey, adapter.id, webhook, { signatureValid }));
      if (!signatureValid) {
        return { status: 401, body: { error: { code: "unauthorized", message: "Bad signature." } } };
      }
      // Acknowledged so the provider stops retrying an event we cannot act on; the adapter has already raised an alert.
      if (error.kind === "unmappable_status") return ok("ignored");
      return { status: 400, body: { error: { code: "invalid_request", message: "Unreadable webhook." } } };
    }

    const kept: Kept = {
      providerEventId: event.eventId,
      signatureValid: true,
      ...(event.providerOrderId ? { providerOrderId: event.providerOrderId } : {}),
    };
    const target = targetState(event.order);
    if (!target) {
      await unit((tx) => keep(tx, dataKey, adapter.id, webhook, kept));
      return ok("ignored");
    }

    return unit(async (tx) => {
      await keep(tx, dataKey, adapter.id, webhook, kept);
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

      const result = await transitionPayout(tx, {
        payoutId: payout.id,
        target,
        cause: `${adapter.id}_webhook`,
        detail: { event: event.eventId, ...evidence(event.order) },
      });
      if (result.outcome === "advanced" && target === "failed" && event.order.status === "failed") {
        await tx.payout.update({
          where: { id: payout.id },
          data: { failureReason: `provider_${event.order.code}` },
        });
      }
      await tx.inboundEvent.updateMany({
        where: { provider: adapter.id, providerEventId: event.eventId },
        data: { payoutId: payout.id, ...(result.outcome === "illegal" ? {} : { processedAt: new Date() }) },
      });
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
