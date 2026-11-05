export type WatchChain = "base" | "polygon" | "solana";
export type StableAsset = "USDC" | "USDT";

// Watches stay open this long after expiry so a late deposit and its refund can still be traced (§10.2).
export const LATE_DEPOSIT_WINDOW_MS = 24 * 60 * 60_000;

export type Watch = {
  id: string;
  chain: WatchChain;
  asset: StableAsset;
  address: string;
  expected: bigint;
  expiresAt: Date;
  received: bigint;
};

export type TokenTransfer = {
  chain: WatchChain;
  asset: StableAsset;
  to: string;
  from: string;
  amount: bigint;
  txHash: string;
  index: number;
  position: bigint;
  at: Date;
};

export type PaymentMatch = "underpaid" | "exact" | "overpaid";

export type DepositObserved = {
  type: "deposit.observed";
  eventId: string;
  watchId: string;
  chain: WatchChain;
  asset: StableAsset;
  address: string;
  from: string;
  txHash: string;
  position: bigint;
  at: Date;
  amount: bigint;
  totalReceived: bigint;
  expected: bigint;
  payment: PaymentMatch;
  late: boolean;
};

export type Cursor = { position: bigint; hash: string };

export type CommitResult = { inserted: readonly string[] };

// The persistence boundary. The Postgres implementation writes messaging.outbox (already in the Prisma schema) and
// needs integration tables for watches, observations and cursors that do not exist yet; until then only
// InMemoryWatcherStore implements it.
export interface WatcherStore {
  activeWatches(chain: WatchChain, now: Date): Promise<Watch[]>;
  cursor(key: string): Promise<Cursor | null>;
  // Already-committed event ids among these, so a rescan never counts a deposit twice in running totals.
  knownEvents(eventIds: readonly string[]): Promise<ReadonlySet<string>>;
  // One transaction: insert every observation whose eventId is new, add an outbox message for each inserted one,
  // and move the cursor. If it throws, nothing was written, so the next scan repeats the same range safely.
  commit(key: string, cursor: Cursor, observations: readonly DepositObserved[]): Promise<CommitResult>;
}

export type WatcherAlert =
  | { kind: "deep_reorg"; chain: WatchChain; position: bigint }
  | { kind: "rpc_unavailable"; chain: WatchChain; detail: string };
