import { isWatchOpen } from "./observe";
import type { CommitResult, Cursor, DepositObserved, Watch, WatchChain, WatcherStore } from "./types";

export type NewWatch = Omit<Watch, "received">;

// Implements the WatcherStore contract in memory for tests and local runs. `outbox` holds what would be published.
export class InMemoryWatcherStore implements WatcherStore {
  readonly outbox: DepositObserved[] = [];
  readonly #watches = new Map<string, NewWatch>();
  readonly #cursors = new Map<string, Cursor>();
  readonly #observations = new Map<string, DepositObserved>();
  #failNextCommit = false;

  addWatch(watch: NewWatch): void {
    this.#watches.set(watch.id, watch);
  }

  failNextCommit(): void {
    this.#failNextCommit = true;
  }

  async activeWatches(chain: WatchChain, now: Date): Promise<Watch[]> {
    return [...this.#watches.values()]
      .filter((watch) => watch.chain === chain)
      .map((watch) => ({ ...watch, received: this.#received(watch.id) }))
      .filter((watch) => isWatchOpen(watch, now));
  }

  async cursor(key: string): Promise<Cursor | null> {
    return this.#cursors.get(key) ?? null;
  }

  async knownEvents(eventIds: readonly string[]): Promise<ReadonlySet<string>> {
    return new Set(eventIds.filter((eventId) => this.#observations.has(eventId)));
  }

  async commit(key: string, cursor: Cursor, observations: readonly DepositObserved[]): Promise<CommitResult> {
    if (this.#failNextCommit) {
      this.#failNextCommit = false;
      throw new Error("simulated failure before commit");
    }
    const inserted: string[] = [];
    for (const observation of observations) {
      if (this.#observations.has(observation.eventId)) continue;
      this.#observations.set(observation.eventId, observation);
      this.outbox.push(observation);
      inserted.push(observation.eventId);
    }
    this.#cursors.set(key, cursor);
    return { inserted };
  }

  #received(watchId: string): bigint {
    let total = 0n;
    for (const observation of this.#observations.values()) {
      if (observation.watchId === watchId) total += observation.amount;
    }
    return total;
  }
}
