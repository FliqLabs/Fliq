import type { Asset } from "../../../packages/ledger/accounts.js";
import { postEntry, vaultMirror } from "../../../packages/ledger/post.js";
import { vaultReconciled } from "../../../packages/ledger/postings.js";
import type { Unit } from "./db.js";

export type Holding = { available: bigint; reserved: bigint };

export type ReconcileDeps = {
  unit: Unit;
  chainBalance: (holder: string) => Promise<Holding>;
  now: () => Date;
  log: (message: string) => void;
  apply: boolean;
};

export type Correction = {
  holder: string;
  asset: Asset;
  ledger: bigint;
  chain: bigint;
  delta: bigint;
  applied: boolean;
  skipped?: string;
};

// The vault contract is the truth. A holder with a payout reserved on either side is left for the next run, so a
// correction never races a payout that is still moving.
export function planCorrection(
  holder: string,
  asset: Asset,
  ledger: Holding,
  chain: Holding,
): Correction | null {
  const delta = chain.available - ledger.available;
  if (delta === 0n) return null;
  const base = { holder, asset, ledger: ledger.available, chain: chain.available, delta, applied: false };
  if (ledger.reserved !== 0n || chain.reserved !== 0n) return { ...base, skipped: "payout_in_flight" };
  return base;
}

export async function reconcileVaultMirror(deps: ReconcileDeps): Promise<Correction[]> {
  const holders = await deps.unit((tx) =>
    tx.account.findMany({
      where: { code: { startsWith: "vault_available:" } },
      select: { ownerId: true, asset: true },
    }),
  );
  const runId = `rec_${deps.now().toISOString()}`;
  const corrections: Correction[] = [];
  for (const { ownerId, asset } of holders) {
    if (!ownerId) continue;
    const chain = await deps.chainBalance(ownerId).catch(() => null);
    if (!chain) continue;
    const ledger = await deps.unit((tx) => vaultMirror(tx, ownerId, asset as Asset));
    const planned = planCorrection(ownerId, asset as Asset, ledger, chain);
    if (!planned) continue;
    if (deps.apply && !planned.skipped) {
      const memo = {
        reason: "chain_reconcile",
        ledger: planned.ledger.toString(),
        chain: planned.chain.toString(),
      };
      await deps.unit((tx) =>
        postEntry(tx, vaultReconciled(runId, ownerId, planned.asset, planned.delta, memo)),
      );
      planned.applied = true;
    }
    deps.log(
      `[vault-reconcile] ${ownerId} ledger ${planned.ledger} chain ${planned.chain} delta ${planned.delta} ${planned.skipped ?? (planned.applied ? "applied" : "dry_run")}`,
    );
    corrections.push(planned);
  }
  return corrections;
}

export function startVaultReconcile(deps: ReconcileDeps, intervalMs: number): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    await reconcileVaultMirror(deps)
      .catch((error: unknown) => deps.log(`[vault-reconcile] failed: ${(error as Error).name}`))
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
