import type { PayoutState } from "../../../packages/domain/payout-state.js";
import {
  isValidRef,
  VaultError,
  type ReceiptRefs,
  type ReceiptStatus,
  type VaultClient,
  type VaultReceipt,
} from "../../../packages/chains/vault/index.js";
import { releaseReservation } from "../../../packages/ledger/post.js";
import type { Unit } from "./db.js";

export type VaultAction =
  | { kind: "none"; reason: string }
  | { kind: "set_status"; status: ReceiptStatus; refs: ReceiptRefs }
  | { kind: "release" };

export type SyncedPayout = {
  id: string;
  state: PayoutState;
  provider: string;
  providerOrderId: string | null;
};

// Backend states the receipt mirrors by name. refunded is reached only through recredit, after the refund is verified.
const MIRRORED: ReadonlySet<PayoutState> = new Set(["routing", "with_provider", "paying_out", "settled", "refunding", "failed"]);
const NEEDS_DISPATCH: ReadonlySet<PayoutState> = new Set(["paying_out", "settled"]);
const ENDED_UNPAID: ReadonlySet<PayoutState> = new Set(["expired", "failed"]);

export function planVaultSync(payout: SyncedPayout, receipt: VaultReceipt | null): VaultAction {
  if (!receipt) return { kind: "none", reason: "no_receipt" };
  if (receipt.state === "released") return { kind: "none", reason: "released" };
  if (receipt.state === "registered") {
    return ENDED_UNPAID.has(payout.state) ? { kind: "release" } : { kind: "none", reason: "awaiting_payout" };
  }
  if (!MIRRORED.has(payout.state)) return { kind: "none", reason: "not_mirrored" };
  if (NEEDS_DISPATCH.has(payout.state) && receipt.transferState !== "dispatched") {
    return { kind: "none", reason: "transfer_not_dispatched" };
  }
  const refs = newRefs(payout, receipt.refs);
  if (receipt.status === payout.state && Object.keys(refs).length === 0) return { kind: "none", reason: "in_sync" };
  return { kind: "set_status", status: payout.state as ReceiptStatus, refs };
}

// Refs are write-once and public, so only send a key the receipt does not hold yet, and only a valid one.
function newRefs(payout: SyncedPayout, current: ReceiptRefs): ReceiptRefs {
  const wanted: ReceiptRefs = {
    provider: payout.provider,
    ...(payout.providerOrderId ? { providerOrder: payout.providerOrderId } : {}),
  };
  const refs: ReceiptRefs = {};
  for (const [key, value] of Object.entries(wanted) as [keyof ReceiptRefs, string][]) {
    if (current[key] === undefined && isValidRef(value)) refs[key] = value;
  }
  return refs;
}

export type VaultSyncDeps = {
  unit: Unit;
  vault: VaultClient;
  now: () => Date;
  log: (message: string) => void;
  windowMs?: number;
  batch?: number;
  done?: Set<string>;
};

export type SyncResult = { payoutId: string; action: VaultAction["kind"]; error?: string };

const DEFAULT_WINDOW_MS = 2 * 24 * 60 * 60_000;
const DEFAULT_BATCH = 50;

// The chain is never written inside a database transaction: read the payouts, then compare each with its receipt.
// Every payout in the window is visited each sweep, a page at a time, so a page of old ones cannot hide newer ones.
// A payout that ended with its receipt released is remembered and not read from the chain again.
export async function syncVaultReceipts(deps: VaultSyncDeps): Promise<SyncResult[]> {
  const since = new Date(deps.now().getTime() - (deps.windowMs ?? DEFAULT_WINDOW_MS));
  const size = deps.batch ?? DEFAULT_BATCH;
  const done = (deps.done ??= new Set());
  const results: SyncResult[] = [];
  let after: string | undefined;
  for (;;) {
    const payouts = (await deps.unit((tx) =>
      tx.payout.findMany({
        where: {
          routeKind: "intents",
          depositChain: "near",
          depositAddress: { not: null },
          updatedAt: { gte: since },
          ...(after ? { id: { gt: after } } : {}),
        },
        select: { id: true, state: true, provider: true, providerOrderId: true },
        orderBy: { id: "asc" },
        take: size,
      }),
    )) as SyncedPayout[];
    for (const payout of payouts) {
      if (done.has(payout.id)) continue;
      const result = await syncOne(deps, payout);
      if (result.settled) done.add(payout.id);
      results.push({ payoutId: result.payoutId, action: result.action, ...(result.error ? { error: result.error } : {}) });
    }
    if (payouts.length < size) return results;
    after = payouts[payouts.length - 1]!.id;
  }
}

async function syncOne(deps: VaultSyncDeps, payout: SyncedPayout): Promise<SyncResult & { settled?: boolean }> {
  try {
    const receipt = await deps.vault.getReceipt(payout.id);
    const action = planVaultSync(payout, receipt);
    if (action.kind === "set_status") await deps.vault.setStatus(payout.id, action.status, action.refs);
    if (action.kind === "release") await deps.vault.releaseOrder(payout.id);
    // A release on chain must free the mirror's reservation too, or the API keeps refusing money the vault holds.
    if (receipt && (receipt.state === "released" || action.kind === "release")) {
      await deps.unit((tx) => releaseReservation(tx, payout.id, receipt.payer, "USDC", receipt.amount));
    }
    // Released is final on chain, and an ended payout never leaves its state, so there is nothing left to mirror.
    const settled = action.kind === "none" && action.reason === "released" && ENDED_UNPAID.has(payout.state);
    return { payoutId: payout.id, action: action.kind, settled };
  } catch (error) {
    const code = error instanceof VaultError ? error.code : (error as Error).name;
    deps.log(`[vault-sync] ${payout.id} ${payout.state}: ${code}`);
    return { payoutId: payout.id, action: "none", error: code };
  }
}

export function startVaultSync(deps: VaultSyncDeps, intervalMs = 15_000): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await syncVaultReceipts(deps);
    } catch (error) {
      deps.log(`[vault-sync] sweep failed: ${(error as Error).name}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
