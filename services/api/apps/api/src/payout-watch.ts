import type { OneClickClient } from "../../../packages/chains/oneclick/client.js";
import type { PayoutState } from "../../../packages/domain/payout-state.js";
import { transitionPayout } from "../../../packages/domain/transition.js";
import type { OrderSnapshot, ProviderAdapter } from "../../../packages/providers/types.js";
import type { Unit } from "./db.js";
import { applyOrderStatus } from "./webhooks.js";

export type WatchDeps = {
  unit: Unit;
  adapters: readonly ProviderAdapter[];
  oneClick?: Pick<OneClickClient, "status">;
  now: () => Date;
  log: (message: string) => void;
  windowMs?: number;
  batch?: number;
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

type Watched = {
  id: string;
  state: string;
  provider: string;
  providerOrderId: string | null;
  routeKind: string;
  depositAddress: string | null;
  depositMemo: string | null;
  createdAt: Date;
};

// ARCH §9.2 and §15: webhooks are the fast path, this poll is the backstop. It also tells providers that match a
// deposit by its transaction hash (Fonbnk) which transfer paid them, once the 1Click leg has delivered.
export async function watchPayouts(deps: WatchDeps): Promise<WatchResult[]> {
  const since = new Date(deps.now().getTime() - (deps.windowMs ?? DEFAULT_WINDOW_MS));
  const payouts = await deps.unit((tx) =>
    tx.payout.findMany({
      where: { state: { in: [...ACTIVE, ...UNKNOWN] }, updatedAt: { gte: since } },
      select: {
        id: true,
        state: true,
        provider: true,
        providerOrderId: true,
        routeKind: true,
        depositAddress: true,
        depositMemo: true,
        createdAt: true,
      },
      orderBy: { updatedAt: "asc" },
      take: deps.batch ?? DEFAULT_BATCH,
    }),
  );
  const results: WatchResult[] = [];
  for (const payout of payouts as Watched[]) {
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
  return results;
}

async function poll(deps: WatchDeps, adapter: ProviderAdapter, payout: Watched): Promise<string> {
  if (!payout.providerOrderId) return "no_order";
  let snapshot = await adapter.getOrder({ providerOrderId: payout.providerOrderId });
  if (!snapshot) return "not_found";
  if (snapshot.status === "awaiting_deposit" && adapter.confirmFunding) {
    snapshot = (await confirmDelivered(deps, adapter, payout)) ?? snapshot;
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

// Only one delivery transfer can be the deposit. Zero or several means a person must look, never a guess.
async function confirmDelivered(
  deps: WatchDeps,
  adapter: ProviderAdapter,
  payout: Watched,
): Promise<OrderSnapshot | null> {
  if (payout.routeKind !== "intents" || !deps.oneClick || !payout.depositAddress || !payout.providerOrderId)
    return null;
  const leg = await deps.oneClick.status(payout.depositAddress, payout.depositMemo ?? undefined);
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

export function startPayoutWatch(deps: WatchDeps, intervalMs = 20_000): () => void {
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
