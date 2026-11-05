import { describe, expect, it } from "vitest";
import {
  eventIdOf,
  InMemoryWatcherStore,
  isWatchOpen,
  LATE_DEPOSIT_WINDOW_MS,
  observe,
  type TokenTransfer,
  type Watch,
} from "./index";

const EXPIRES = new Date("2026-11-05T12:30:00.000Z");
const ADDRESS = "0x76B4c56085ED136a8744D52bE956396624A730E8";

const watch = (overrides: Partial<Watch> = {}): Watch => ({
  id: "po_1",
  chain: "base",
  asset: "USDC",
  address: ADDRESS,
  expected: 50_000_000n,
  expiresAt: EXPIRES,
  received: 0n,
  ...overrides,
});

const transfer = (overrides: Partial<TokenTransfer> = {}): TokenTransfer => ({
  chain: "base",
  asset: "USDC",
  to: ADDRESS.toLowerCase(),
  from: "0xsender",
  amount: 50_000_000n,
  txHash: "0xAAA",
  index: 0,
  position: 100n,
  at: new Date("2026-11-05T12:10:00.000Z"),
  ...overrides,
});

describe("observe", () => {
  it("matches an exact deposit case-insensitively on EVM and gives it a stable id", () => {
    const [seen] = observe([watch()], [transfer()]);
    expect(seen).toMatchObject({
      watchId: "po_1",
      payment: "exact",
      totalReceived: 50_000_000n,
      late: false,
    });
    expect(seen?.eventId).toBe("base:0xaaa:0");
  });

  it("adds split payments up: underpaid, then exact, then overpaid", () => {
    const observations = observe(
      [watch()],
      [
        transfer({ txHash: "0x3", amount: 5n, position: 103n }),
        transfer({ txHash: "0x1", amount: 40_000_000n, position: 101n }),
        transfer({ txHash: "0x2", amount: 10_000_000n, position: 102n }),
      ],
    );
    expect(observations.map((o) => [o.amount, o.totalReceived, o.payment])).toEqual([
      [40_000_000n, 40_000_000n, "underpaid"],
      [10_000_000n, 50_000_000n, "exact"],
      [5n, 50_000_005n, "overpaid"],
    ]);
  });

  it("continues from what was already received and skips committed events", () => {
    const committed = new Set([eventIdOf(transfer({ txHash: "0x1" }))]);
    const observations = observe(
      [watch({ received: 40_000_000n })],
      [
        transfer({ txHash: "0x1", amount: 40_000_000n }),
        transfer({ txHash: "0x2", amount: 10_000_000n, position: 101n }),
      ],
      committed,
    );
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ txHash: "0x2", totalReceived: 50_000_000n, payment: "exact" });
  });

  it("marks a deposit that lands after expiry as late", () => {
    const [late] = observe([watch()], [transfer({ at: new Date(EXPIRES.getTime() + 1) })]);
    expect(late?.late).toBe(true);
  });

  it("ignores other assets, unknown addresses, zero amounts and repeats within a batch", () => {
    const observations = observe(
      [watch()],
      [
        transfer({ asset: "USDT" }),
        transfer({ to: "0xsomeoneelse" }),
        transfer({ amount: 0n, txHash: "0xzero" }),
        transfer(),
        transfer(),
      ],
    );
    expect(observations).toHaveLength(1);
  });

  it("keeps Solana addresses and signatures case-sensitive", () => {
    const solana = watch({ chain: "solana", address: "TokenAcctAbc" });
    const sol = (to: string, txHash: string) => transfer({ chain: "solana", to, txHash });
    expect(observe([solana], [sol("tokenacctabc", "Sig1")])).toEqual([]);
    expect(eventIdOf(sol("TokenAcctAbc", "SigAbC"))).toBe("solana:SigAbC:0");
  });
});

describe("watch window", () => {
  it("stays open for 24 hours after expiry", () => {
    expect(isWatchOpen(watch(), new Date(EXPIRES.getTime() + LATE_DEPOSIT_WINDOW_MS))).toBe(true);
    expect(isWatchOpen(watch(), new Date(EXPIRES.getTime() + LATE_DEPOSIT_WINDOW_MS + 1))).toBe(false);
  });
});

describe("InMemoryWatcherStore", () => {
  it("publishes each event once and moves the cursor in the same commit", async () => {
    const store = new InMemoryWatcherStore();
    store.addWatch(watch());
    const observations = observe(await store.activeWatches("base", EXPIRES), [transfer()]);
    expect((await store.commit("base", { position: 100n, hash: "0xh" }, observations)).inserted).toEqual([
      "base:0xaaa:0",
    ]);
    expect((await store.commit("base", { position: 101n, hash: "0xi" }, observations)).inserted).toEqual([]);
    expect(store.outbox).toHaveLength(1);
    expect(await store.cursor("base")).toEqual({ position: 101n, hash: "0xi" });
    expect((await store.activeWatches("base", EXPIRES))[0]?.received).toBe(50_000_000n);
    expect(await store.knownEvents(["base:0xaaa:0", "base:0xbbb:0"])).toEqual(new Set(["base:0xaaa:0"]));
  });

  it("writes nothing when a commit fails", async () => {
    const store = new InMemoryWatcherStore();
    store.addWatch(watch());
    store.failNextCommit();
    await expect(
      store.commit("base", { position: 100n, hash: "0xh" }, observe([watch()], [transfer()])),
    ).rejects.toThrow();
    expect(store.outbox).toEqual([]);
    expect(await store.cursor("base")).toBeNull();
  });
});
