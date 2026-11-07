import type { Payout, PayoutClaim, PayoutEvent, Prisma } from "@prisma/client";
import { newId } from "../../../packages/db/src/ids.js";
import { formatTokenAmount } from "./dashboard.js";
import type { Db, Unit } from "./db.js";
import { conflict, notFound } from "./errors.js";
import type { Reply } from "./idempotency.js";
import { developerIdFor, requestQuote, type QuoteDeps, type QuoteInput } from "./quotes.js";

const RETRYABLE: ReadonlySet<string> = new Set(["refunded", "failed", "expired"]);
const REVERSAL_AFTER_MS = 24 * 60 * 60_000;

type Stage = "deposit" | "routing" | "provider" | "bank";

const detailOf = (event: PayoutEvent | undefined): Prisma.JsonObject =>
  event && typeof event.detail === "object" && event.detail !== null && !Array.isArray(event.detail) ? event.detail : {};

// Providers report that a refund happened, never why the bank credit failed, so the stage is where the payout stopped.
function stageOf(event: PayoutEvent): Stage {
  if (event.toState === "expired") return "deposit";
  if (event.fromState === "routing") return "routing";
  if (event.fromState === "paying_out") return "bank";
  return "provider";
}

export function claimView(claim: PayoutClaim, events: readonly PayoutEvent[], bankReference: string | null) {
  const settledAt = events.find((event) => event.toState === "settled")?.createdAt ?? claim.openedAt;
  return {
    claim_id: claim.id,
    payout_id: claim.payoutId,
    state: claim.state,
    bank_reference: bankReference,
    opened_at: claim.openedAt.toISOString(),
    reversal_after: new Date(settledAt.getTime() + REVERSAL_AFTER_MS).toISOString(),
  };
}

export function recoveryView(
  payout: Payout & { events: PayoutEvent[]; retries: Pick<Payout, "id" | "createdAt">[]; claims: PayoutClaim[] },
  bankReference: string | null,
) {
  const stopped = payout.events.find((event) => event.toState === "refunding" || event.toState === "failed" || event.toState === "expired");
  const refunded = payout.events.find((event) => event.toState === "refunded");
  const refundTx = detailOf(refunded).refund_tx_hash;
  const latestRetry = [...payout.retries].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const claim = [...payout.claims].sort((a, b) => Number(b.state === "open") - Number(a.state === "open") || b.openedAt.getTime() - a.openedAt.getTime())[0];
  return {
    failure: stopped ? { stage: stageOf(stopped), code: payout.failureReason, at: stopped.createdAt.toISOString() } : null,
    refund: refunded
      ? {
          amount: formatTokenAmount(payout.amountIn),
          to: payout.routeKind === "direct" ? ("sender" as const) : ("vault" as const),
          at: refunded.createdAt.toISOString(),
          tx: typeof refundTx === "string" ? refundTx : null,
        }
      : null,
    // No provider has confirmed the sender name its credits show on a bank alert yet.
    settlement_name: null,
    retry_of: payout.retryOfId,
    retried_by: latestRetry?.id ?? null,
    claim: claim ? claimView(claim, payout.events, bankReference) : null,
  };
}

async function ownedPayout(tx: Db, userId: string, payoutId: string) {
  const payout = await tx.payout.findFirst({ where: { id: payoutId, developerId: await developerIdFor(tx, userId) }, include: { events: { orderBy: { version: "asc" } } } });
  if (!payout) throw notFound("No such payout.");
  return payout;
}

export async function quoteRetry(unit: Unit, deps: QuoteDeps, userId: string, payoutId: string) {
  return unit(async (tx) => {
    const payout = await ownedPayout(tx, userId, payoutId);
    if (!RETRYABLE.has(payout.state)) throw conflict("Only a refunded, failed or expired payout can be tried again.");
    const quote = await tx.quote.findUniqueOrThrow({ where: { id: payout.quoteId } });
    const input: QuoteInput = {
      token: quote.tokenSymbol.toLowerCase() as QuoteInput["token"],
      currency: payout.currency as QuoteInput["currency"],
      amount: formatTokenAmount(payout.amountIn),
      source_chain: quote.sourceChain,
    };
    return requestQuote(tx, { ...deps, adapters: deps.adapters.filter((adapter) => adapter.id !== payout.provider) }, userId, input);
  });
}

export async function openClaim(tx: Db, userId: string, payoutId: string, bankReference: (events: readonly PayoutEvent[]) => string | null): Promise<Reply> {
  const payout = await ownedPayout(tx, userId, payoutId);
  if (payout.state !== "settled") throw conflict("Only a paid payout can be chased with the bank.");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`claim:${payout.id}`}, 0))`;
  const reference = bankReference(payout.events);
  const open = await tx.payoutClaim.findFirst({ where: { payoutId: payout.id, state: "open" } });
  if (open) return { status: 200, body: claimView(open, payout.events, reference) };

  const claim = await tx.payoutClaim.create({ data: { id: newId("clm"), payoutId: payout.id, userId } });
  await tx.outbox.create({
    data: {
      id: newId("obx"),
      topic: "support",
      routingKey: payout.id,
      eventType: "payout.claim_opened",
      payload: { claim_id: claim.id, payout_id: payout.id, provider: payout.provider, provider_order: payout.providerOrderId, bank_reference: reference },
    },
  });
  return { status: 201, body: claimView(claim, payout.events, reference) };
}
