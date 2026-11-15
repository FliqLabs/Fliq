import type { OneClickClient } from "../../../packages/chains/oneclick/client.js";
import type { OneClickExecution } from "../../../packages/chains/oneclick/types.js";
import type { PayoutState } from "../../../packages/domain/payout-state.js";
import { transitionPayout } from "../../../packages/domain/transition.js";
import type { OrderSnapshot, ProviderAdapter } from "../../../packages/providers/types.js";
import type { Unit } from "./db.js";
import { hopReporter } from "./hop-watch.js";
import { applyOrderStatus } from "./webhooks.js";

export type WatchDeps = {
  unit: Unit;
  adapters: readonly ProviderAdapter[];
  oneClick?: Pick<OneClickClient, "status">;
  now: () => Date;
  log: (message: string) => void;
  reportHop?: ReturnType<typeof hopReporter>;
  windowMs?: number;
  batch?: number;
  // Expired payouts whose swap 1Click has finished, so they are not asked about again.
  finishedHops?: Set<string>;
};

export type WatchResult = { payoutId: string; outcome: string };

// States in which the provider holds the next move. A lost webhook would leave these stuck without a poll.
const ACTIVE: PayoutState[] = [
  "awaiting_deposit",
  "deposit_seen",
  "routing",
  "with_provider",
  "paying_out",
  "refunding",
];
const UNKNOWN: PayoutState[] = ["provider_timeout", "awaiting_recon"];
// How long an order the provider says it never received may stay unknown before the payout fails. Nothing was sent.
const GIVE_UP_MS = 10 * 60_000;
const DEFAULT_WINDOW_MS = 2 * 24 * 60 * 60_000;
const DEFAULT_BATCH = 50;

const WATCHED = {
  id: true,
  state: true,
  provider: true,
  providerOrderId: true,
  routeKind: true,
  depositAddress: true,
  depositMemo: true,
  depositValidUntil: true,
  createdAt: true,
} as const;

type Watched = {
  id: string;
  state: string;
  provider: string;
  providerOrderId: string | null;
  routeKind: string;
  depositAddress: string | null;
  depositMemo: string | null;
  depositValidUntil: Date | null;
  createdAt: Date;
};

// ARCH §9.2 and §15: webhooks are the fast path, this poll is the backstop. It also tells providers that match a
// deposit by its transaction hash (Fonbnk) which transfer paid them, once the 1Click leg has delivered.
// Every open payout is visited each sweep, a page at a time: taking only the oldest page would leave newer payouts
// unwatched for as long as a page of stuck ones stays open.
export async function watchPayouts(deps: WatchDeps): Promise<WatchResult[]> {
  const since = new Date(deps.now().getTime() - (deps.windowMs ?? DEFAULT_WINDOW_MS));
  const results: WatchResult[] = [];
  const open = { state: { in: [...ACTIVE, ...UNKNOWN] }, updatedAt: { gte: since } };
  for await (const payout of pages(deps, open)) {
    const adapter = deps.adapters.find((candidate) => candidate.id === payout.provider);
    if (!adapter) continue;
    try {
      const outcome = UNKNOWN.includes(payout.state as PayoutState)
        ? await resolveUnknown(deps, adapter, payout)
        : await poll(deps, adapter, payout);
      results.push({ payoutId: payout.id, outcome });
    } catch (error) {
      deps.log(`[payout-watch] ${payout.id} ${payout.provider} ${payout.state}: ${(error as Error).name}`);
      results.push({ payoutId: payout.id, outcome: "error" });
    }
  }
  results.push(...(await watchLapsedHops(deps, since)));
  return results;
}

async function* pages(deps: WatchDeps, where: Record<string, unknown>): AsyncGenerator<Watched> {
  const size = deps.batch ?? DEFAULT_BATCH;
  let after: string | undefined;
  for (;;) {
    const page = (await deps.unit((tx) =>
      tx.payout.findMany({
        where: after ? { ...where, id: { gt: after } } : where,
        select: WATCHED,
        orderBy: { id: "asc" },
        take: size,
      }),
    )) as Watched[];
    yield* page;
    if (page.length < size) return;
    after = page[page.length - 1]!.id;
  }
}

// 1Click cannot be cancelled and keeps its own deadline, so a swap can still be moving after the payout expired.
// The provider is no longer polled then, but the swap is followed until 1Click finishes it, so a late delivery or a
// refund is reported instead of going unseen.
async function watchLapsedHops(deps: WatchDeps, since: Date): Promise<WatchResult[]> {
  if (!deps.oneClick) return [];
  const finished = (deps.finishedHops ??= new Set());
  const results: WatchResult[] = [];
  const lapsed = { state: "expired", routeKind: "intents", depositAddress: { not: null }, updatedAt: { gte: since } };
  for await (const payout of pages(deps, lapsed)) {
    if (finished.has(payout.id)) continue;
    const leg = await hopOf(deps, payout);
    if (!leg) continue;
    if (leg.status === "PENDING_DEPOSIT" || leg.status === "REFUNDED" || leg.status === "FAILED") finished.add(payout.id);
    if (leg.status === "SUCCESS") {
      finished.add(payout.id);
      deps.log(
        `[hop-watch] ${payout.id}: 1Click delivered after the payout expired; the USDC is with ${payout.provider} or its refund address and must be traced by hand`,
      );
    }
    results.push({ payoutId: payout.id, outcome: `lapsed_hop:${leg.status}` });
  }
  return results;
}

async function poll(deps: WatchDeps, adapter: ProviderAdapter, payout: Watched): Promise<string> {
  if (!payout.providerOrderId) return "no_order";
  let snapshot = await adapter.getOrder({ providerOrderId: payout.providerOrderId });
  if (!snapshot) return "not_found";
  if (snapshot.status === "awaiting_deposit") {
    const leg = await hopOf(deps, payout);
    if (leg && adapter.confirmFunding) snapshot = (await confirmDelivered(deps, adapter, payout, leg)) ?? snapshot;
  }
  return apply(deps, payout, snapshot);
}

function apply(deps: WatchDeps, payout: Watched, snapshot: OrderSnapshot): Promise<string> {
  const detail = snapshot.status === "failed" ? `:${snapshot.code}` : "";
  return deps.unit((tx) =>
    applyOrderStatus(tx, {
      payoutId: payout.id,
      provider: payout.provider,
      eventId: `poll:${payout.id}:${snapshot.status}${detail}`,
      order: snapshot,
      cause: `${payout.provider}_poll`,
    }),
  );
}

// The swap that carries the USDC to the provider. A provider still waiting for its deposit is the one moment the
// swap can be stuck, so that is when it is read and reported. A failed read never holds up the provider poll.
async function hopOf(deps: WatchDeps, payout: Watched): Promise<OneClickExecution | null> {
  if (payout.routeKind !== "intents" || !deps.oneClick || !payout.depositAddress) return null;
  try {
    const leg = await deps.oneClick.status(payout.depositAddress, payout.depositMemo ?? undefined);
    deps.reportHop?.({ payoutId: payout.id, createdAt: payout.createdAt, validUntil: payout.depositValidUntil }, leg, deps.now());
    return leg;
  } catch (error) {
    deps.log(`[payout-watch] ${payout.id}: 1Click status ${(error as Error).name}`);
    return null;
  }
}

// Only one delivery transfer can be the deposit. Zero or several means a person must look, never a guess.
async function confirmDelivered(
  deps: WatchDeps,
  adapter: ProviderAdapter,
  payout: Watched,
  leg: OneClickExecution,
): Promise<OrderSnapshot | null> {
  if (!payout.providerOrderId) return null;
  if (leg.status !== "SUCCESS") return null;
  if (leg.destinationTxHashes.length !== 1) {
    deps.log(
      `[payout-watch] ${payout.id}: 1Click delivered with ${leg.destinationTxHashes.length} transfers; confirm ${payout.provider} by hand`,
    );
    return null;
  }
  return adapter.confirmFunding!(payout.providerOrderId, leg.destinationTxHashes[0]!);
}

// createOrder timed out, so we do not know whether the provider has the order. Ask by our reference: found means
// an operator finishes it with the provider's details; still missing after GIVE_UP_MS means nothing was created.
async function resolveUnknown(deps: WatchDeps, adapter: ProviderAdapter, payout: Watched): Promise<string> {
  const found = await adapter.getOrder({ reference: payout.id });
  return deps.unit(async (tx) => {
    if (payout.state === "provider_timeout")
      await transitionPayout(tx, { payoutId: payout.id, target: "awaiting_recon", cause: "poll_requery" });
    if (found) {
      if (payout.providerOrderId === found.providerOrderId) return "found";
      await tx.payout.update({ where: { id: payout.id }, data: { providerOrderId: found.providerOrderId } });
      deps.log(
        `[payout-watch] ${payout.id}: ${payout.provider} has the order after a timeout; reconcile it by hand`,
      );
      return "found";
    }
    if (deps.now().getTime() - payout.createdAt.getTime() < GIVE_UP_MS) return "waiting";
    await tx.payout.update({ where: { id: payout.id }, data: { failureReason: "provider_order_not_found" } });
    await transitionPayout(tx, { payoutId: payout.id, target: "failed", cause: "poll_not_found" });
    return "failed";
  });
}

// The app asks about its own payout every couple of seconds while the user watches the screen. Asking the provider
// then, at most every REFRESH_MS per payout, shows "paid" within seconds even when a webhook is late or never comes.
const REFRESH_MS = 3_000;

export function payoutRefresher(deps: WatchDeps): (payoutId: string) => Promise<void> {
  const asked = new Map<string, number>();
  return async (payoutId) => {
    const at = deps.now().getTime();
    if (at - (asked.get(payoutId) ?? 0) < REFRESH_MS) return;
    asked.set(payoutId, at);
    try {
      const payout = (await deps.unit((tx) => tx.payout.findUnique({ where: { id: payoutId }, select: WATCHED }))) as Watched | null;
      const adapter = payout && deps.adapters.find((candidate) => candidate.id === payout.provider);
      if (!payout || !adapter || !ACTIVE.includes(payout.state as PayoutState)) return void asked.delete(payoutId);
      await poll(deps, adapter, payout);
    } catch (error) {
      deps.log(`[payout-watch] refresh ${payoutId}: ${(error as Error).name}`);
    }
  };
}

export function startPayoutWatch(input: WatchDeps, intervalMs = 20_000): () => void {
  const deps = { ...input, reportHop: input.reportHop ?? hopReporter(input.log) };
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await watchPayouts(deps);
    } catch (error) {
      deps.log(`[payout-watch] sweep failed: ${(error as Error).name}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
