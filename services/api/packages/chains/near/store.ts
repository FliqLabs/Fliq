import { randomUUID } from "node:crypto";

export type RelayRecord =
  | { state: "in_progress" }
  | {
      state: "submitted" | "succeeded" | "failed" | "pending";
      txHash: string;
      senderId: string;
      receiverId: string;
      failures: string[];
    };

export type KeyLease = { key: string; token: string };

// Shared state for every relayer replica. Redis in deployment; memory for tests. Losing it loses no money:
// the chain still refuses replayed nonces, so the worst case is a refused, paid-for duplicate.
export interface RelayStore {
  takeRateSlot(sender: string, limit: number, windowMs: number, nowMs: number): Promise<boolean>;
  // Returns null when this caller now owns the hash, or the record someone else already wrote.
  claim(hash: string, ttlMs: number): Promise<RelayRecord | null>;
  save(hash: string, record: RelayRecord, ttlMs: number): Promise<void>;
  forget(hash: string): Promise<void>;
  read(hash: string): Promise<RelayRecord | null>;
  lease(keys: readonly string[], ttlMs: number): Promise<KeyLease | null>;
  release(lease: KeyLease): Promise<void>;
  // max(stored, onChain) + 1, stored atomically, so two transactions never reuse a nonce.
  nextNonce(key: string, onChain: bigint): Promise<bigint>;
}

export class MemoryRelayStore implements RelayStore {
  readonly #hits = new Map<string, number[]>();
  readonly #records = new Map<string, { record: RelayRecord; expiresAt: number }>();
  readonly #leases = new Map<string, { token: string; expiresAt: number }>();
  readonly #nonces = new Map<string, bigint>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  async takeRateSlot(sender: string, limit: number, windowMs: number, nowMs: number): Promise<boolean> {
    const recent = (this.#hits.get(sender) ?? []).filter((at) => at > nowMs - windowMs);
    if (recent.length >= limit) {
      this.#hits.set(sender, recent);
      return false;
    }
    this.#hits.set(sender, [...recent, nowMs]);
    return true;
  }

  // Check and set with no await between them, matching Redis SET NX: two simultaneous claims cannot both win.
  async claim(hash: string, ttlMs: number): Promise<RelayRecord | null> {
    const existing = this.#current(hash);
    if (existing) return existing;
    this.#records.set(hash, { record: { state: "in_progress" }, expiresAt: this.#now() + ttlMs });
    return null;
  }

  async save(hash: string, record: RelayRecord, ttlMs: number): Promise<void> {
    this.#records.set(hash, { record, expiresAt: this.#now() + ttlMs });
  }

  async forget(hash: string): Promise<void> {
    this.#records.delete(hash);
  }

  async read(hash: string): Promise<RelayRecord | null> {
    return this.#current(hash);
  }

  #current(hash: string): RelayRecord | null {
    const entry = this.#records.get(hash);
    return entry && entry.expiresAt > this.#now() ? entry.record : null;
  }

  async lease(keys: readonly string[], ttlMs: number): Promise<KeyLease | null> {
    for (const key of keys) {
      const held = this.#leases.get(key);
      if (held && held.expiresAt > this.#now()) continue;
      const token = randomUUID();
      this.#leases.set(key, { token, expiresAt: this.#now() + ttlMs });
      return { key, token };
    }
    return null;
  }

  async release(lease: KeyLease): Promise<void> {
    if (this.#leases.get(lease.key)?.token === lease.token) this.#leases.delete(lease.key);
  }

  async nextNonce(key: string, onChain: bigint): Promise<bigint> {
    const stored = this.#nonces.get(key) ?? 0n;
    const next = (stored > onChain ? stored : onChain) + 1n;
    this.#nonces.set(key, next);
    return next;
  }
}
