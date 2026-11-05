import type { IncomingHttpHeaders } from "node:http";
import { encrypt } from "../../../packages/db/src/crypto.js";
import { newId } from "../../../packages/db/src/ids.js";
import type { PayoutState } from "../../../packages/domain/payout-state.js";
import { transitionPayout } from "../../../packages/domain/transition.js";
import { ProviderError } from "../../../packages/providers/errors.js";
import type { OrderStatus, ProviderAdapter, WebhookEvent } from "../../../packages/providers/types.js";
import type { Config } from "./config.js";
import type { Db, Unit } from "./db.js";
import type { Reply } from "./idempotency.js";

export interface ProviderHookDeps {
  config: Config;
  unit: Unit;
  adapters: readonly ProviderAdapter[];
}

const TARGET: Record<OrderStatus["status"], PayoutState | null> = {
  awaiting_deposit: null,
  deposit_received: "with_provider",
  processing: "paying_out",
  paid: "settled",
  refunding: "refunding",
  refunded: "refunded",
  failed: "failed",
};

type Parsed = { ok: true; event: WebhookEvent } | { ok: false; signatureValid: boolean };

const received = (outcome: string): Reply => ({ status: 200, body: { received: true, outcome } });

function flatten(headers: IncomingHttpHeaders): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name, Array.isArray(value) ? value[0] : value]),
  );
}

// Every adapter checks the signature before reading the body, so any other parse failure was signed by the provider.
function parse(adapter: ProviderAdapter, headers: IncomingHttpHeaders, rawBody: string): Parsed {
  try {
    return { ok: true, event: adapter.parseWebhook({ headers: flatten(headers), rawBody }) };
  } catch (error) {
    const signatureValid = error instanceof ProviderError && error.kind !== "invalid_signature";
    return { ok: false, signatureValid };
  }
}

async function findPayout(tx: Db, provider: string, event: WebhookEvent): Promise<string | null> {
  if (event.reference) {
    const byReference = await tx.payout.findFirst({
      where: { id: event.reference, provider },
      select: { id: true },
    });
    if (byReference) return byReference.id;
  }
  if (!event.providerOrderId) return null;
  const byOrder = await tx.payout.findFirst({
    where: { provider, providerOrderId: event.providerOrderId },
    select: { id: true },
  });
  return byOrder?.id ?? null;
}

function detailOf(provider: string, event: WebhookEvent) {
  const { order } = event;
  return {
    provider,
    event_id: event.eventId,
    ...(order.status === "paid" && order.fiatReference ? { fiat_reference: order.fiatReference } : {}),
    ...(order.status === "refunded" && order.refundTxHash ? { refund_tx_hash: order.refundTxHash } : {}),
    ...(order.status === "failed" ? { failure_code: order.code } : {}),
  };
}

// ARCH §9.4: store first, then act. Signature failures are kept for audit and never touch a payout.
// Until the messaging package exists, the update is applied here instead of being published to q.provider.inbound.
export async function receiveProviderWebhook(
  deps: ProviderHookDeps,
  provider: string,
  headers: IncomingHttpHeaders,
  rawBody: string,
): Promise<Reply> {
  const adapter = deps.adapters.find((candidate) => candidate.id === provider);
  if (!adapter) return { status: 404, body: { error: { code: "not_found", message: "No such route." } } };

  const parsed = parse(adapter, headers, rawBody);
  const bodyCipher = encrypt(rawBody, deps.config.dataKey);

  return deps.unit(async (tx) => {
    if (!parsed.ok) {
      await tx.inboundEvent.create({
        data: { id: newId("ine"), provider, signatureValid: parsed.signatureValid, bodyCipher },
      });
      if (parsed.signatureValid) return received("unreadable");
      return {
        status: 401,
        body: { error: { code: "invalid_signature", message: "Signature check failed." } },
      };
    }

    const { event } = parsed;
    const payoutId = await findPayout(tx, provider, event);
    const id = newId("ine");
    const stored = await tx.inboundEvent.createMany({
      data: [
        {
          id,
          provider,
          providerEventId: event.eventId,
          signatureValid: true,
          bodyCipher,
          providerOrderId: event.providerOrderId ?? null,
          payoutId,
        },
      ],
      skipDuplicates: true,
    });
    if (stored.count === 0) return received("duplicate");
    if (!payoutId) return received("unknown_payout");

    const target = TARGET[event.order.status];
    if (target) {
      const result = await transitionPayout(tx, {
        payoutId,
        target,
        cause: `provider_${event.order.status}`,
        detail: detailOf(provider, event),
      });
      // The state machine refused the move (e.g. failed straight from with_provider). Left unprocessed for an operator.
      if (result.outcome === "illegal") return received("not_applied");
      if (result.outcome === "advanced" && event.order.status === "failed") {
        await tx.payout.update({
          where: { id: payoutId },
          data: { failureReason: `provider_${event.order.code}` },
        });
      }
    }
    await tx.inboundEvent.update({ where: { id }, data: { processedAt: new Date() } });
    return received("processed");
  });
}
