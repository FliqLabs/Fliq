import { beforeEach, describe, expect, it } from "vitest";
import {
  InMemoryWatcherStore,
  nextScanDelay,
  scanEvm,
  type EvmBlock,
  type EvmRpc,
  type EvmTransferLog,
  type EvmWatcherConfig,
  type TransferQuery,
  type WatcherAlert,
} from "./index";

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const USDT = "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2";
const DEPOSIT = "0x76b4c56085ed136a8744d52be956396624a730e8";
const T0 = Date.parse("2026-11-05T12:00:00.000Z");

const config: EvmWatcherConfig = {
  chain: "base",
  tokens: { USDC, USDT },
  confirmations: 2,
  maxBlockRange: 10,
  maxRecipientsPerQuery: 100,
  reorgRewindBlocks: 5,
};

class FakeChain implements EvmRpc {
  head = 0n;
  readonly logQueries: TransferQuery[] = [];
  #fork = "a";
  #logs: Omit<EvmTransferLog, "blockHash">[] = [];
  #failNext: keyof EvmRpc | null = null;

  hashOf(number: bigint): string {
    return `0x${this.#fork}${number.toString(16)}`;
  }

  mineTo(number: bigint): void {
    this.head = number;
  }

  transfer(blockNumber: bigint, amount: bigint, overrides: Partial<EvmTransferLog> = {}): void {
    this.#logs.push({
      token: USDC,
      from: "0x5e0de",
      to: DEPOSIT,
      amount,
      txHash: `0xtx${blockNumber}`,
      logIndex: 0,
      blockNumber,
      removed: false,
      ...overrides,
    });
  }

  reorgFrom(number: bigint): void {
    this.#fork = "b";
    this.#logs = this.#logs.filter((log) => log.blockNumber < number);
  }

  failNext(method: keyof EvmRpc): void {
    this.#failNext = method;
  }

  async blockNumber(): Promise<bigint> {
    this.#maybeFail("blockNumber");
    return this.head;
  }

  async block(number: bigint): Promise<EvmBlock | null> {
    this.#maybeFail("block");
    if (number > this.head) return null;
    return { number, hash: this.hashOf(number), timestamp: new Date(T0 + Number(number) * 2_000) };
  }

  async transferLogs(query: TransferQuery): Promise<EvmTransferLog[]> {
    this.#maybeFail("transferLogs");
    this.logQueries.push(query);
    return this.#logs
      .filter((log) => log.blockNumber >= query.fromBlock && log.blockNumber <= query.toBlock)
      .filter((log) => query.tokens.includes(log.token) && query.recipients.includes(log.to))
      .map((log) => ({ ...log, blockHash: this.hashOf(log.blockNumber) }));
  }

  #maybeFail(method: keyof EvmRpc): void {
    if (this.#failNext !== method) return;
    this.#failNext = null;
    throw new Error(`${method} unavailable`);
  }
}

let chain: FakeChain;
let store: InMemoryWatcherStore;
let alerts: WatcherAlert[];
let now: Date;

const scan = () =>
  scanEvm(config, { rpc: chain, store, now: () => now, alert: (alert) => alerts.push(alert) });

async function scanUntilCaughtUp(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    const result = await scan();
    if (result.status !== "scanned" || result.caughtUp) return;
  }
}

beforeEach(async () => {
  chain = new FakeChain();
  store = new InMemoryWatcherStore();
  alerts = [];
  now = new Date(T0 + 200_000);
  chain.mineTo(100n);
  expect(await scan()).toEqual({ status: "initialized" });
  store.addWatch({
    id: "po_1",
    chain: "base",
    asset: "USDC",
    address: DEPOSIT,
    expected: 50_000_000n,
    expiresAt: new Date(T0 + 600_000),
  });
});

describe("scanEvm", () => {
  it("starts at the confirmed head and publishes a deposit only once it has enough confirmations", async () => {
    expect(await store.cursor("base")).toEqual({ position: 98n, hash: chain.hashOf(98n) });
    chain.transfer(101n, 50_000_000n);
    chain.mineTo(102n);
    await scanUntilCaughtUp();
    expect(store.outbox).toEqual([]);
    chain.mineTo(103n);
    await scanUntilCaughtUp();
    expect(store.outbox).toHaveLength(1);
    expect(store.outbox[0]).toMatchObject({
      eventId: "base:0xtx101:0",
      payment: "exact",
      late: false,
      position: 101n,
    });
  });

  it("loses and duplicates nothing when the commit fails mid-scan and the watcher restarts", async () => {
    chain.transfer(101n, 50_000_000n);
    chain.mineTo(110n);
    store.failNextCommit();
    await expect(scan()).rejects.toThrow("simulated failure");
    expect(await store.cursor("base")).toEqual({ position: 98n, hash: chain.hashOf(98n) });
    await scanUntilCaughtUp();
    await scanUntilCaughtUp();
    expect(store.outbox.map((event) => event.eventId)).toEqual(["base:0xtx101:0"]);
  });

  it("leaves the cursor in place when an RPC call fails part way", async () => {
    chain.transfer(101n, 50_000_000n);
    chain.mineTo(110n);
    chain.failNext("transferLogs");
    await expect(scan()).rejects.toThrow("unavailable");
    chain.failNext("block");
    await expect(scan()).rejects.toThrow("unavailable");
    expect((await store.cursor("base"))?.position).toBe(98n);
    await scanUntilCaughtUp();
    expect(store.outbox).toHaveLength(1);
  });

  it("rewinds and rescans after a reorg deeper than the confirmations, without publishing twice", async () => {
    chain.transfer(101n, 20_000_000n, { txHash: "0xkept" });
    chain.mineTo(104n);
    await scanUntilCaughtUp();
    expect(store.outbox).toHaveLength(1);

    chain.reorgFrom(102n);
    chain.transfer(101n, 20_000_000n, { txHash: "0xkept" });
    chain.transfer(102n, 30_000_000n, { txHash: "0xnew" });
    chain.mineTo(106n);
    await scanUntilCaughtUp();

    expect(alerts).toEqual([{ kind: "deep_reorg", chain: "base", position: 102n }]);
    expect(store.outbox.map((event) => [event.txHash, event.totalReceived, event.payment])).toEqual([
      ["0xkept", 20_000_000n, "underpaid"],
      ["0xnew", 50_000_000n, "exact"],
    ]);
    expect(await store.cursor("base")).toEqual({ position: 104n, hash: chain.hashOf(104n) });
  });

  it("scans a long gap in bounded ranges", async () => {
    chain.mineTo(130n);
    expect(await scan()).toMatchObject({ status: "scanned", from: 99n, to: 108n, caughtUp: false });
    await scanUntilCaughtUp();
    expect(chain.logQueries.map((query) => [query.fromBlock, query.toBlock])).toEqual([
      [99n, 108n],
      [109n, 118n],
      [119n, 128n],
    ]);
  });

  it("traces a late deposit inside the 24 hour window", async () => {
    now = new Date(T0 + 3_600_000);
    chain.transfer(400n, 50_000_000n);
    chain.mineTo(410n);
    for (let i = 0; i < 40; i += 1) await scan();
    expect(store.outbox[0]).toMatchObject({ late: true, payment: "exact" });
  });

  it("ignores removed logs and other tokens, and maps USDT by contract", async () => {
    store.addWatch({
      id: "po_t",
      chain: "base",
      asset: "USDT",
      address: "0xabc",
      expected: 1n,
      expiresAt: new Date(T0 + 600_000),
    });
    chain.transfer(101n, 50_000_000n, { removed: true });
    chain.transfer(102n, 1n, { token: USDT, to: "0xabc", txHash: "0xusdt" });
    chain.mineTo(110n);
    await scanUntilCaughtUp();
    expect(store.outbox.map((event) => [event.watchId, event.asset])).toEqual([["po_t", "USDT"]]);
  });

  it("only moves the cursor when no watch is open, and polls slowly", async () => {
    now = new Date(T0 + 600_000 + 25 * 3_600_000);
    chain.mineTo(200n);
    const result = await scan();
    expect(result).toEqual({ status: "idle" });
    expect(nextScanDelay(result)).toBe(60_000);
    expect(chain.logQueries).toEqual([]);
    expect((await store.cursor("base"))?.position).toBe(198n);
  });

  it("polls every 3 seconds while a watch is live and immediately while behind", async () => {
    chain.mineTo(102n);
    const live = await scan();
    expect(nextScanDelay(live)).toBe(3_000);
    expect(
      nextScanDelay({
        status: "scanned",
        from: 1n,
        to: 2n,
        published: 0,
        caughtUp: false,
        onlyExpired: false,
      }),
    ).toBe(0);
    expect(
      nextScanDelay({ status: "scanned", from: 1n, to: 2n, published: 0, caughtUp: true, onlyExpired: true }),
    ).toBe(60_000);
  });
});
