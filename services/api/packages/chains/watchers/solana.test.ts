import { beforeEach, describe, expect, it } from "vitest";
import {
  InMemoryWatcherStore,
  nextSolanaScanDelay,
  scanSolana,
  type SignatureInfo,
  type SignaturePage,
  type SolanaRpc,
  type SolanaWatcherConfig,
  type TokenCredit,
  type WatcherAlert,
} from "./index";

const USDC_MINT = "UsdcMint1111111111111111111111111111111111";
const OTHER_MINT = "OtherMint111111111111111111111111111111111";
const ACCOUNT = "DepositTokenAccount11111111111111111111111";
const T0 = Date.parse("2026-11-05T12:00:00.000Z");

type Tx = SignatureInfo & { credit: TokenCredit | null };

class FakeSolana implements SolanaRpc {
  readonly #txs = new Map<string, Tx[]>();
  failCreditFor: string | null = null;
  signatureCalls = 0;

  send(address: string, signature: string, amount: bigint, overrides: Partial<Tx> = {}): void {
    const list = this.#txs.get(address) ?? [];
    const slot = BigInt(100 + list.length);
    const credit = {
      mint: USDC_MINT,
      amount,
      from: "SenderWallet",
      slot,
      at: new Date(T0 + list.length * 1_000),
    };
    list.push({ signature, slot, failed: false, credit, ...overrides });
    this.#txs.set(address, list);
  }

  async signatures(address: string, page: SignaturePage): Promise<SignatureInfo[]> {
    this.signatureCalls += 1;
    const newestFirst = [...(this.#txs.get(address) ?? [])].reverse();
    const start = page.before ? newestFirst.findIndex((tx) => tx.signature === page.before) + 1 : 0;
    const stop = page.until ? newestFirst.findIndex((tx) => tx.signature === page.until) : -1;
    const window = newestFirst.slice(start, stop === -1 ? undefined : stop);
    return window.slice(0, page.limit).map(({ signature, slot, failed }) => ({ signature, slot, failed }));
  }

  async tokenCredit(signature: string): Promise<TokenCredit | null> {
    if (signature === this.failCreditFor) throw new Error("getTransaction unavailable");
    for (const list of this.#txs.values()) {
      const tx = list.find((candidate) => candidate.signature === signature);
      if (tx) return tx.credit;
    }
    return null;
  }
}

const config: SolanaWatcherConfig = { mints: { USDC: USDC_MINT }, pageSize: 2, maxPages: 10 };

let rpc: FakeSolana;
let store: InMemoryWatcherStore;
let alerts: WatcherAlert[];
let now: Date;

const scan = () => scanSolana(config, { rpc, store, now: () => now, alert: (alert) => alerts.push(alert) });
const watchOn = (id: string, address: string, expected = 50_000_000n) =>
  store.addWatch({
    id,
    chain: "solana",
    asset: "USDC",
    address,
    expected,
    expiresAt: new Date(T0 + 600_000),
  });

beforeEach(() => {
  rpc = new FakeSolana();
  store = new InMemoryWatcherStore();
  alerts = [];
  now = new Date(T0 + 60_000);
  watchOn("po_1", ACCOUNT);
});

describe("scanSolana", () => {
  it("publishes a deposit once and finds nothing new on the next scan", async () => {
    rpc.send(ACCOUNT, "Sig1", 50_000_000n);
    expect(await scan()).toEqual({ watches: 1, published: 1, failed: 0, onlyExpired: false });
    expect(await scan()).toMatchObject({ published: 0 });
    expect(store.outbox[0]).toMatchObject({
      eventId: "solana:Sig1:0",
      payment: "exact",
      from: "SenderWallet",
    });
    expect(await store.cursor(`solana:${ACCOUNT}`)).toEqual({ position: 100n, hash: "Sig1" });
  });

  it("pages back to the cursor and processes deposits oldest first", async () => {
    for (const [signature, amount] of [
      ["S1", 10n],
      ["S2", 20n],
      ["S3", 30n],
      ["S4", 40n],
      ["S5", 50n],
    ] as const) {
      rpc.send(ACCOUNT, signature, amount * 1_000_000n);
    }
    await scan();
    expect(store.outbox.map((event) => [event.txHash, event.totalReceived])).toEqual([
      ["S1", 10_000_000n],
      ["S2", 30_000_000n],
      ["S3", 60_000_000n],
      ["S4", 100_000_000n],
      ["S5", 150_000_000n],
    ]);
    expect(store.outbox.at(-1)?.payment).toBe("overpaid");
  });

  it("skips failed transactions and other mints but still moves past them", async () => {
    rpc.send(ACCOUNT, "Failed", 50_000_000n, { failed: true });
    rpc.send(ACCOUNT, "Other", 50_000_000n, {
      credit: { mint: OTHER_MINT, amount: 1n, from: "x", slot: 101n, at: null },
    });
    await scan();
    expect(store.outbox).toEqual([]);
    expect((await store.cursor(`solana:${ACCOUNT}`))?.hash).toBe("Other");
  });

  it("commits nothing when a transaction read fails part way, then catches up once", async () => {
    rpc.send(ACCOUNT, "Sig1", 20_000_000n);
    rpc.send(ACCOUNT, "Sig2", 30_000_000n);
    rpc.failCreditFor = "Sig2";
    expect(await scan()).toMatchObject({ published: 0, failed: 1 });
    expect(alerts[0]).toMatchObject({ kind: "rpc_unavailable", chain: "solana" });
    expect(await store.cursor(`solana:${ACCOUNT}`)).toBeNull();
    rpc.failCreditFor = null;
    await scan();
    expect(store.outbox.map((event) => [event.txHash, event.payment])).toEqual([
      ["Sig1", "underpaid"],
      ["Sig2", "exact"],
    ]);
  });

  it("loses and duplicates nothing when the commit fails and the watcher restarts", async () => {
    rpc.send(ACCOUNT, "Sig1", 50_000_000n);
    store.failNextCommit();
    expect(await scan()).toMatchObject({ failed: 1 });
    await scan();
    await scan();
    expect(store.outbox.map((event) => event.eventId)).toEqual(["solana:Sig1:0"]);
  });

  it("keeps scanning other watches when one fails", async () => {
    watchOn("po_2", "SecondTokenAccount111111111111111111111111");
    rpc.send(ACCOUNT, "Bad", 1n);
    rpc.send("SecondTokenAccount111111111111111111111111", "Good", 50_000_000n);
    rpc.failCreditFor = "Bad";
    expect(await scan()).toMatchObject({ watches: 2, published: 1, failed: 1 });
    expect(store.outbox[0]?.watchId).toBe("po_2");
  });

  it("marks a deposit after expiry as late and polls expired watches slowly", async () => {
    now = new Date(T0 + 2 * 3_600_000);
    rpc.send(ACCOUNT, "Late", 50_000_000n, {
      credit: {
        mint: USDC_MINT,
        amount: 50_000_000n,
        from: "SenderWallet",
        slot: 900n,
        at: new Date(T0 + 3_600_000),
      },
    });
    const result = await scan();
    expect(store.outbox[0]?.late).toBe(true);
    expect(nextSolanaScanDelay(result)).toBe(60_000);
  });

  it("makes no RPC calls and polls slowly when nothing is watched", async () => {
    now = new Date(T0 + 600_000 + 25 * 3_600_000);
    const result = await scan();
    expect(result).toEqual({ watches: 0, published: 0, failed: 0, onlyExpired: true });
    expect(rpc.signatureCalls).toBe(0);
    expect(nextSolanaScanDelay(result)).toBe(60_000);
  });
});
