import { describe, expect, it } from "vitest";
import { sandboxAdapters } from "../apps/api/src/sandbox.js";
import { createRates, RATE_TTL_MS } from "../apps/api/src/rates.js";
import { DEFAULT_ROUTING_CONFIG, NO_SIGNALS } from "../packages/domain/routing.js";

const START = new Date("2026-11-06T10:00:00Z");

function setup(adapters = sandboxAdapters()) {
  let clock = START.getTime();
  let calls = 0;
  const counted = adapters.map((adapter) => ({
    ...adapter,
    quote: (...args: Parameters<typeof adapter.quote>) => {
      calls += 1;
      return adapter.quote(...args);
    },
  }));
  const getRate = createRates({ adapters: counted, routing: DEFAULT_ROUTING_CONFIG, signals: NO_SIGNALS, now: () => new Date(clock) });
  return { getRate, calls: () => calls, advance: (ms: number) => (clock += ms) };
}

describe("getRate", () => {
  it("returns the best after-fee rate with the fees taken out of it", async () => {
    const rate = await setup().getRate("usdc", "ngn");
    expect(rate).toMatchObject({ token: "usdc", currency: "ngn", provider: "mock", providers_quoting: 1, fetched_at: START.toISOString() });
    expect(rate.rate).toBeGreaterThan(0);
    expect(rate.rate_before_fees).toBeGreaterThanOrEqual(rate.rate);
    expect(rate.spread).toBeCloseTo(rate.rate_before_fees - rate.rate, 4);
  });

  it("serves repeat calls from the cache for 10 seconds", async () => {
    const { getRate, calls, advance } = setup();
    const first = await getRate("usdc", "ngn");
    const quotedOnce = calls();
    advance(RATE_TTL_MS - 1);
    expect(await getRate("usdc", "ngn")).toBe(first);
    expect(calls()).toBe(quotedOnce);
    advance(1);
    const refreshed = await getRate("usdc", "ngn");
    expect(refreshed.fetched_at).not.toBe(first.fetched_at);
    expect(calls()).toBeGreaterThan(quotedOnce);
  });

  it("rejects a token or currency outside the corridor list", () => {
    const { getRate } = setup();
    expect(() => getRate("dai", "ngn")).toThrow(/Unsupported token/);
    expect(() => getRate("usdc", "toString")).toThrow(/Unsupported currency/);
  });

  it("does not cache a failure", async () => {
    const { getRate } = setup([]);
    await expect(getRate("usdc", "ngn")).rejects.toMatchObject({ status: 422, code: "no_route" });
    await expect(getRate("usdc", "ngn")).rejects.toMatchObject({ status: 422 });
  });
});
