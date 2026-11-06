import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createOneClickClient,
  createOneClickMock,
  mockAssetId,
  type OneClickClient,
  type QuoteInput,
} from "./index";

let now: Date;
let server: Server;
let baseUrl: string;
let oneClick: OneClickClient;

const advance = (ms: number) => {
  now = new Date(now.getTime() + ms);
};

const input = (amount: bigint, overrides: Partial<QuoteInput> = {}): QuoteInput => ({
  dry: false,
  swapType: "EXACT_OUTPUT",
  slippageBps: 50,
  originAsset: mockAssetId("sol", "USDC"),
  destinationAsset: mockAssetId("base", "USDC"),
  amount,
  refundTo: "sender-refund-address",
  recipient: "0x76b4c56085ed136a8744d52be956396624a730e8",
  deadline: new Date(now.getTime() + 30 * 60_000),
  appFees: [{ recipient: "fees.fliq.near", feeBps: 30 }],
  ...overrides,
});

async function depositExactly(depositAddress: string, amount: bigint): Promise<void> {
  await fetch(`${baseUrl}/mock/deposit`, {
    method: "POST",
    body: JSON.stringify({ depositAddress, amount: amount.toString() }),
  });
}

async function swapTo(amount: bigint): Promise<string> {
  const quote = await oneClick.quote(input(amount));
  await oneClick.submitDeposit({ txHash: "0xdeposit", depositAddress: quote.depositAddress! });
  return quote.depositAddress!;
}

beforeEach(async () => {
  now = new Date("2026-11-05T12:00:00.000Z");
  const mock = createOneClickMock({ now: () => now, processingAfterMs: 2_000, settleAfterMs: 30_000 });
  server = createServer((req, res) => void mock.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  oneClick = createOneClickClient({ baseUrl, apiKey: undefined });
});

afterEach(() => server.close());

describe("mock 1Click quotes", () => {
  it("lists stablecoins per chain in the token shape", async () => {
    const tokens = await oneClick.tokens();
    expect(tokens).toContainEqual({
      assetId: "mock:base:usdc",
      decimals: 6,
      blockchain: "base",
      symbol: "USDC",
      contractAddress: undefined,
    });
  });

  it("prices an exact-output hop 1:1 plus fees, with slippage on the input side", async () => {
    const quote = await oneClick.quote(input(50_000_000n));
    expect(quote).toMatchObject({
      amountOut: 50_000_000n,
      minAmountOut: 50_000_000n,
      minAmountIn: 50_200_000n,
      amountIn: 50_451_000n,
      timeEstimateSeconds: 30,
    });
    expect(quote.depositAddress).toMatch(/^0x[0-9a-f]{40}$/);
    expect(quote.deadline).toEqual(input(1n).deadline);
  });

  it("returns no deposit address for a dry quote", async () => {
    expect((await oneClick.quote(input(50_000_000n, { dry: true }))).depositAddress).toBeUndefined();
  });

  it("refuses amounts below the minimum, unknown assets and past deadlines with a message", async () => {
    await expect(oneClick.quote(input(999_999n))).rejects.toMatchObject({ kind: "rejected" });
    await expect(oneClick.quote(input(50_000_000n, { originAsset: "mock:btc:btc" }))).rejects.toMatchObject({
      message: "1click quote rejected: unknown asset",
    });
    await expect(oneClick.quote(input(50_000_000n, { originAsset: "mock:base:usdt" }))).rejects.toMatchObject(
      {
        message: "1click quote rejected: unknown asset",
      },
    );
    await expect(oneClick.quote(input(50_000_000n, { deadline: now }))).rejects.toMatchObject({
      kind: "rejected",
    });
  });
});

describe("mock 1Click swaps", () => {
  it("waits for a deposit, then moves through processing to SUCCESS", async () => {
    const quote = await oneClick.quote(input(50_000_000n));
    const address = quote.depositAddress!;
    expect((await oneClick.status(address)).status).toBe("PENDING_DEPOSIT");
    expect((await oneClick.submitDeposit({ txHash: "0xdeposit", depositAddress: address })).status).toBe(
      "KNOWN_DEPOSIT_TX",
    );
    advance(2_000);
    expect((await oneClick.status(address)).status).toBe("PROCESSING");
    advance(28_000);
    const done = await oneClick.status(address);
    expect(done).toMatchObject({ status: "SUCCESS", amountOut: 50_000_000n, depositedAmount: 50_451_000n });
    expect(done.originTxHashes).toEqual(["0xdeposit"]);
    expect(done.destinationTxHashes).toHaveLength(1);
  });

  it.each([
    [50_000_001n, "REFUNDED"],
    [50_000_002n, "FAILED"],
    [50_000_003n, "PROCESSING"],
  ])("ends a swap for %s in %s", async (amount, status) => {
    const address = await swapTo(amount);
    advance(60 * 60_000);
    expect((await oneClick.status(address)).status).toBe(status);
  });

  it("holds an underpaid deposit as INCOMPLETE_DEPOSIT and refunds it after the deadline", async () => {
    const quote = await oneClick.quote(input(50_000_000n));
    await depositExactly(quote.depositAddress!, 40_000_000n);
    expect((await oneClick.status(quote.depositAddress!)).status).toBe("INCOMPLETE_DEPOSIT");
    advance(31 * 60_000);
    expect(await oneClick.status(quote.depositAddress!)).toMatchObject({
      status: "REFUNDED",
      refundedAmount: 40_000_000n,
      refundReason: "PARTIAL_DEPOSIT",
    });
  });

  it("answers an unknown deposit address with 404, which the client reports as refused", async () => {
    await expect(oneClick.status("0xunknown")).rejects.toMatchObject({ kind: "rejected", httpStatus: 404 });
  });

  it("records only the first deposit for an address", async () => {
    const address = await swapTo(50_000_000n);
    await depositExactly(address, 1n);
    advance(30_000);
    expect((await oneClick.status(address)).depositedAmount).toBe(50_451_000n);
  });
});
