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

export type StatusSignal = { payoutId: string; provider: string; eventId: string; order: OrderStatus; cause: string };

// Moves a payout from a provider's order status, whether it came by webhook or by polling. The inbox makes a
// status seen twice (a webhook and a poll, or a redelivery) apply once.
export async function applyOrderStatus(tx: Db, signal: StatusSignal): Promise<string> {
  const target = targetState(signal.order);
  if (!target) return "ignored";
  // An order expires only while it waits for its deposit. A provider that later expires a quote it already refunded
  // (Bitnob after an underpayment) is describing the past, not a new state.
  if (target === "expired") {
    const { state } = await tx.payout.findUniqueOrThrow({ where: { id: signal.payoutId }, select: { state: true } });
    if (state !== "awaiting_deposit") return "ignored";
  }
  const fresh = await tx.inbox.createMany({ data: [{ consumer: signal.provider, messageId: signal.eventId }], skipDuplicates: true });
  if (fresh.count === 0) return "duplicate";

  const result = await transitionPayout(tx, {
    payoutId: signal.payoutId,
    target,
    cause: signal.cause,
    detail: { event: signal.eventId, ...evidence(signal.order) },
  });
  if (result.outcome === "advanced" && target === "failed" && signal.order.status === "failed") {
    await tx.payout.update({ where: { id: signal.payoutId }, data: { failureReason: `provider_${signal.order.code}` } });
  }
  if (result.outcome === "illegal") {
    await tx.deadLetter.create({
      data: {
        id: newId("dlq"),
        queue: `${signal.provider}_webhook`,
        messageId: signal.eventId,
        payload: { payoutId: signal.payoutId, state: result.state, target },
        error: "transition_illegal",
        attempts: 1,
      },
    });
  }
  return result.outcome;
}

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
      // The provider can call back before our create-order transaction commits. 503 is the answer every provider
      // retries; some (Bitnob) treat a 404 as final and never send the event again.
      if (!payout) return { status: 503, body: { error: { code: "unavailable", message: "Unknown order. Retry later." } } };

      const outcome = await applyOrderStatus(tx, { payoutId: payout.id, provider: adapter.id, eventId: event.eventId, order: event.order, cause: `${adapter.id}_webhook` });
      await tx.inboundEvent.updateMany({
        where: { provider: adapter.id, providerEventId: event.eventId },
        data: { payoutId: payout.id, ...(outcome === "illegal" ? {} : { processedAt: new Date() }) },
      });
      return ok(outcome);
    });
  };
}
