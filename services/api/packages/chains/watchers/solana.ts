import { ACTIVE_INTERVAL_MS, IDLE_INTERVAL_MS } from "./evm";
import { eventIdOf, observe } from "./observe";
import type { SignatureInfo, SolanaRpc } from "./solana-rpc";
import type { StableAsset, TokenTransfer, Watch, WatcherAlert, WatcherStore } from "./types";

export type SolanaWatcherConfig = {
  mints: Partial<Record<StableAsset, string>>;
  pageSize: number;
  maxPages: number;
};

export type SolanaWatcherDeps = {
  rpc: SolanaRpc;
  store: WatcherStore;
  now: () => Date;
  alert: (alert: WatcherAlert) => void;
};

export type SolanaScanResult = { watches: number; published: number; failed: number; onlyExpired: boolean };

export function nextSolanaScanDelay(result: SolanaScanResult): number {
  return result.watches === 0 || result.onlyExpired ? IDLE_INTERVAL_MS : ACTIVE_INTERVAL_MS;
}

// Each watch is a token account (§10.2): querying the owner wallet would not return its token-account transfers.
// A failing watch raises an alert and is retried next time; it never holds up the others.
export async function scanSolana(
  config: SolanaWatcherConfig,
  deps: SolanaWatcherDeps,
): Promise<SolanaScanResult> {
  const now = deps.now();
  const watches = await deps.store.activeWatches("solana", now);
  let published = 0;
  let failed = 0;
  for (const watch of watches) {
    try {
      published += await scanWatch(config, deps, watch);
    } catch (error) {
      failed += 1;
      deps.alert({
        kind: "rpc_unavailable",
        chain: "solana",
        detail: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  const onlyExpired = watches.every((watch) => watch.expiresAt <= now);
  return { watches: watches.length, published, failed, onlyExpired };
}

async function scanWatch(
  config: SolanaWatcherConfig,
  deps: SolanaWatcherDeps,
  watch: Watch,
): Promise<number> {
  const key = `solana:${watch.address}`;
  const cursor = await deps.store.cursor(key);
  const fresh = await newSignatures(config, deps.rpc, watch.address, cursor?.hash);
  const newest = fresh[0];
  if (!newest) return 0;

  const transfers: TokenTransfer[] = [];
  for (const info of [...fresh].reverse()) {
    if (info.failed) continue;
    const credit = await deps.rpc.tokenCredit(info.signature, watch.address);
    const asset = credit && assetOf(config, credit.mint);
    if (!credit || !asset) continue;
    transfers.push({
      chain: "solana",
      asset,
      to: watch.address,
      from: credit.from,
      amount: credit.amount,
      txHash: info.signature,
      index: 0,
      position: credit.slot,
      at: credit.at ?? deps.now(),
    });
  }
  const known = await deps.store.knownEvents(transfers.map(eventIdOf));
  const observations = observe([watch], transfers, known);
  const { inserted } = await deps.store.commit(
    key,
    { position: newest.slot, hash: newest.signature },
    observations,
  );
  return inserted.length;
}

// Pages backwards from the newest signature to the cursor so nothing between them is skipped.
async function newSignatures(
  config: SolanaWatcherConfig,
  rpc: SolanaRpc,
  address: string,
  until: string | undefined,
): Promise<SignatureInfo[]> {
  const all: SignatureInfo[] = [];
  let before: string | undefined;
  for (let page = 0; page < config.maxPages; page += 1) {
    const batch = await rpc.signatures(address, { until, before, limit: config.pageSize });
    all.push(...batch);
    if (batch.length < config.pageSize) return all;
    before = batch.at(-1)?.signature;
  }
  throw new Error(`more than ${config.maxPages * config.pageSize} new signatures for one watch`);
}

function assetOf(config: SolanaWatcherConfig, mint: string): StableAsset | undefined {
  return (Object.keys(config.mints) as StableAsset[]).find((asset) => config.mints[asset] === mint);
}
