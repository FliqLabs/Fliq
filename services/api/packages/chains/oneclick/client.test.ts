import { describe, expect, it } from "vitest";
import { OneClickError, quoteBody } from "./index";
import {
  API_KEY,
  DEPOSIT,
  execution,
  fakeFetch,
  hang,
  json,
  quoteInput,
  quoteResponse,
  testClient as client,
} from "./oneclick.fixtures";

describe("1Click client requests", () => {
  it("sends the quote in the documented shape with the API key header", async () => {
    const fake = fakeFetch(() => json(quoteResponse));
    const quote = await client(fake.fetch).quote(quoteInput);
    const request = fake.requests[0]!;
    expect(request.url).toBe("https://1click.example.com/v0/quote");
    expect(request.headers.get("x-api-key")).toBe(API_KEY);
    expect(await request.json()).toEqual({
      dry: false,
      swapType: "EXACT_OUTPUT",
      slippageTolerance: 50,
      originAsset: "nep141:sol-usdc.omft.near",
      depositType: "ORIGIN_CHAIN",
      destinationAsset: "nep141:base-usdc.omft.near",
      amount: "50000000",
      refundTo: "SenderSolanaAddress111111111111111111111111",
      refundType: "ORIGIN_CHAIN",
      recipient: DEPOSIT,
      recipientType: "DESTINATION_CHAIN",
      deadline: "2026-11-05T12:30:00.000Z",
      appFees: [{ recipient: "fees.fliq.near", fee: 30 }],
    });
    expect(quote).toMatchObject({
      amountIn: 50_300_000n,
      minAmountIn: 50_050_000n,
      amountOut: 50_000_000n,
      timeEstimateSeconds: 35,
    });
    expect(quote.raw).toEqual(quoteResponse);
  });

  it("omits the key header when no key is configured and queries status by deposit address", async () => {
    const fake = fakeFetch(() => json(execution("PENDING_DEPOSIT")));
    await client(fake.fetch, { withKey: false }).status(DEPOSIT, "memo-1");
    expect(fake.requests[0]!.headers.has("x-api-key")).toBe(false);
    expect(fake.requests[0]!.url).toBe(
      `https://1click.example.com/v0/status?depositAddress=${DEPOSIT}&depositMemo=memo-1`,
    );
  });

  it("refuses fractional basis points and non-positive amounts before calling", () => {
    expect(() => quoteBody({ ...quoteInput, slippageBps: 0.5 })).toThrow(RangeError);
    expect(() => quoteBody({ ...quoteInput, appFees: [{ recipient: "f.near", feeBps: 2.5 }] })).toThrow(
      RangeError,
    );
    expect(() => quoteBody({ ...quoteInput, amount: 0n })).toThrow(RangeError);
  });
});

describe("1Click client responses", () => {
  it("parses executions into integer amounts and hashes", async () => {
    const fake = fakeFetch(() =>
      json(
        execution("SUCCESS", {
          amountIn: "50300000",
          amountOut: "50000000",
          depositedAmount: "50300000",
          originChainTxHashes: [{ hash: "5xSol", explorerUrl: "https://x" }],
          destinationChainTxHashes: [{ hash: "0xbase", explorerUrl: "https://y" }],
          nearTxHashes: ["near1"],
        }),
      ),
    );
    expect(await client(fake.fetch).status(DEPOSIT)).toEqual({
      status: "SUCCESS",
      updatedAt: new Date("2026-11-05T12:01:00.000Z"),
      depositedAmount: 50_300_000n,
      amountIn: 50_300_000n,
      amountOut: 50_000_000n,
      refundedAmount: undefined,
      refundReason: undefined,
      originTxHashes: ["5xSol"],
      destinationTxHashes: ["0xbase"],
      nearTxHashes: ["near1"],
    });
  });

  it.each([
    ["an unknown status", execution("HELD")],
    ["a decimal amount", execution("SUCCESS", { amountOut: "50.5" })],
    ["a missing updatedAt", { ...execution("SUCCESS"), updatedAt: undefined }],
    ["a non-object body", ["SUCCESS"]],
  ])("treats %s as an invalid response, never as an outcome", async (_, body) => {
    const fake = fakeFetch(() => json(body));
    await expect(client(fake.fetch).status(DEPOSIT)).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("requires a deposit address and deadline on a non-dry quote", async () => {
    const { depositAddress: _, ...withoutAddress } = quoteResponse.quote;
    const fake = fakeFetch(() => json({ ...quoteResponse, quote: withoutAddress }));
    await expect(client(fake.fetch).quote(quoteInput)).rejects.toMatchObject({ kind: "invalid_response" });
    const dry = await client(fakeFetch(() => json({ ...quoteResponse, quote: withoutAddress })).fetch).quote({
      ...quoteInput,
      dry: true,
    });
    expect(dry.depositAddress).toBeUndefined();
  });
});

describe("1Click client failures", () => {
  it("retries a status read on an outage and returns the answer", async () => {
    const fake = fakeFetch(
      () => new Response("", { status: 503 }),
      () => json(execution("PROCESSING")),
    );
    expect((await client(fake.fetch).status(DEPOSIT)).status).toBe("PROCESSING");
    expect(fake.requests).toHaveLength(2);
  });

  it("never retries a quote", async () => {
    const fake = fakeFetch(() => new Response("", { status: 502 }));
    await expect(client(fake.fetch).quote(quoteInput)).rejects.toMatchObject({ kind: "unavailable" });
    expect(fake.requests).toHaveLength(1);
  });

  it("reports a refused request with 1Click's message and does not retry it", async () => {
    const fake = fakeFetch(() =>
      json({ message: "Amount is too low for bridge, try at least 1000000" }, 400),
    );
    await expect(client(fake.fetch).status(DEPOSIT)).rejects.toMatchObject({
      kind: "rejected",
      message: "1click status rejected: Amount is too low for bridge, try at least 1000000",
    });
    expect(fake.requests).toHaveLength(1);
  });

  it("does not retry or leak a refused API key", async () => {
    const fake = fakeFetch(() => new Response("", { status: 401 }));
    const error: unknown = await client(fake.fetch)
      .status(DEPOSIT)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OneClickError);
    expect(error).toMatchObject({ kind: "unauthorized" });
    expect((error as OneClickError).message).not.toContain(API_KEY);
    expect(fake.requests).toHaveLength(1);
  });

  it("times out each attempt and gives up after three reads", async () => {
    const fake = fakeFetch(hang);
    await expect(client(fake.fetch).status(DEPOSIT, undefined, { timeoutMs: 10 })).rejects.toMatchObject({
      kind: "timeout",
    });
    expect(fake.requests).toHaveLength(3);
  });

  it("stops immediately when the caller cancels", async () => {
    const fake = fakeFetch(hang);
    const controller = new AbortController();
    const pending = client(fake.fetch).status(DEPOSIT, undefined, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: "cancelled" });
    expect(fake.requests).toHaveLength(1);
  });
});
