import type { EvmBlock, EvmRpc, EvmTransferLog } from "./evm-rpc";
import { RpcError } from "./evm-rpc";
import { eventIdOf, observe } from "./observe";
import type { Cursor, StableAsset, TokenTransfer, Watch, WatcherAlert, WatcherStore } from "./types";

export const ACTIVE_INTERVAL_MS = 3_000;
export const IDLE_INTERVAL_MS = 60_000;

export type EvmWatcherConfig = {
  chain: "base" | "polygon";
  tokens: Partial<Record<StableAsset, string>>;
  confirmations: number;
  maxBlockRange: number;
  maxRecipientsPerQuery: number;
  reorgRewindBlocks: number;
};

export type EvmWatcherDeps = {
  rpc: EvmRpc;
  store: WatcherStore;
  now: () => Date;
  alert: (alert: WatcherAlert) => void;
};

export type ScanResult =
  | { status: "initialized" | "idle" | "waiting" }
  | {
      status: "scanned";
      from: bigint;
      to: bigint;
      published: number;
      caughtUp: boolean;
      onlyExpired: boolean;
    };

// Watches past expiry only wait for late deposits, so they are checked at the idle rate (decision record 0001).
export function nextScanDelay(result: ScanResult): number {
  if (result.status === "scanned" && !result.caughtUp) return 0;
  if (result.status === "idle" || (result.status === "scanned" && result.onlyExpired))
    return IDLE_INTERVAL_MS;
  return ACTIVE_INTERVAL_MS;
}

// One scan step over a bounded range of confirmed blocks. It commits observations and the cursor together, so a
// failure anywhere (RPC, inconsistent chain data, the store) leaves the cursor where it was and the next scan
// repeats the same range; event ids make that repeat harmless.
export async function scanEvm(config: EvmWatcherConfig, deps: EvmWatcherDeps): Promise<ScanResult> {
  const { chain } = config;
  // The head is read before the watches: a watch created after this point can only be paid in a later block, so
  // fast-forwarding an idle cursor to this height can never skip its deposit.
  const safe = (await deps.rpc.blockNumber()) - BigInt(config.confirmations);
  if (safe < 0n) return { status: "waiting" };

  const cursor = await deps.store.cursor(chain);
  const now = deps.now();
  const watches = await deps.store.activeWatches(chain, now);
  if (!cursor || watches.length === 0) {
    await deps.store.commit(chain, toCursor(await requireBlock(deps.rpc, safe)), []);
    return { status: cursor ? "idle" : "initialized" };
  }

  const start = await checkedStart(config, deps, cursor);
  const from = start + 1n;
  if (from > safe) return { status: "waiting" };
  const to = min(safe, from + BigInt(config.maxBlockRange) - 1n);

  const logs = (await fetchLogs(config, deps.rpc, watches, from, to)).filter((log) => !log.removed);
  const blocks = await blocksFor(deps.rpc, [...new Set([...logs.map((log) => log.blockNumber), to])]);
  const transfers = logs.map((log) => toTransfer(config, log, blocks));
  const known = await deps.store.knownEvents(transfers.map(eventIdOf));
  const observations = observe(watches, transfers, known);
  const { inserted } = await deps.store.commit(chain, toCursor(blocks.get(to)!), observations);
  const onlyExpired = watches.every((watch) => watch.expiresAt <= now);
  return { status: "scanned", from, to, published: inserted.length, caughtUp: to === safe, onlyExpired };
}

// If the block under the cursor is no longer canonical, a reorg went deeper than the confirmation depth.
async function checkedStart(config: EvmWatcherConfig, deps: EvmWatcherDeps, cursor: Cursor): Promise<bigint> {
  const canonical = await deps.rpc.block(cursor.position);
  if (canonical?.hash === cursor.hash) return cursor.position;
  deps.alert({ kind: "deep_reorg", chain: config.chain, position: cursor.position });
  const rewound = cursor.position - BigInt(config.reorgRewindBlocks);
  return rewound > 0n ? rewound : 0n;
}

async function fetchLogs(
  config: EvmWatcherConfig,
  rpc: EvmRpc,
  watches: readonly Watch[],
  fromBlock: bigint,
  toBlock: bigint,
): Promise<EvmTransferLog[]> {
  const tokens = [...new Set(watches.map((watch) => config.tokens[watch.asset]))].filter(
    (token): token is string => token !== undefined,
  );
  const recipients = [...new Set(watches.map((watch) => watch.address.toLowerCase()))];
  const logs: EvmTransferLog[] = [];
  for (let i = 0; i < recipients.length; i += config.maxRecipientsPerQuery) {
    const batch = recipients.slice(i, i + config.maxRecipientsPerQuery);
    logs.push(...(await rpc.transferLogs({ fromBlock, toBlock, tokens, recipients: batch })));
  }
  return logs;
}

async function blocksFor(rpc: EvmRpc, numbers: readonly bigint[]): Promise<Map<bigint, EvmBlock>> {
  const blocks = new Map<bigint, EvmBlock>();
  for (const number of numbers) blocks.set(number, await requireBlock(rpc, number));
  return blocks;
}

function toTransfer(
  config: EvmWatcherConfig,
  log: EvmTransferLog,
  blocks: Map<bigint, EvmBlock>,
): TokenTransfer {
  const block = blocks.get(log.blockNumber)!;
  if (block.hash.toLowerCase() !== log.blockHash.toLowerCase()) {
    throw new RpcError(
      "eth_getLogs",
      "invalid_response",
      "log block hash is not canonical; retrying the range",
    );
  }
  const asset = (Object.keys(config.tokens) as StableAsset[]).find(
    (candidate) => config.tokens[candidate]?.toLowerCase() === log.token,
  );
  if (!asset) throw new RpcError("eth_getLogs", "invalid_response", "log from an unwatched token");
  return {
    chain: config.chain,
    asset,
    to: log.to,
    from: log.from,
    amount: log.amount,
    txHash: log.txHash,
    index: log.logIndex,
    position: log.blockNumber,
    at: block.timestamp,
  };
}

async function requireBlock(rpc: EvmRpc, number: bigint): Promise<EvmBlock> {
  const block = await rpc.block(number);
  if (!block) throw new RpcError("eth_getBlockByNumber", "invalid_response", `block ${number} not found`);
  return block;
}

function toCursor(block: EvmBlock): Cursor {
  return { position: block.number, hash: block.hash };
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
