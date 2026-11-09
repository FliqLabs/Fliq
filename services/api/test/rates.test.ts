import { describe, expect, it } from "vitest";
import type { Unit } from "../apps/api/src/db.js";
import { quoteAndSave } from "../apps/api/src/quotes.js";
import { sandboxAdapters } from "../apps/api/src/sandbox.js";
import { createRates, RATE_TTL_MS } from "../apps/api/src/rates.js";
import { DEFAULT_ROUTING_CONFIG, NO_SIGNALS, type HopPricer } from "../packages/domain/routing.js";
import type { ProviderAdapter } from "../packages/providers/types.js";

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

const never = <T>() => new Promise<T>(() => {});

// A provider that only takes funds on Base, so pricing it from NEAR has to ask the hop first.
function onBaseOnly(adapter: ProviderAdapter): ProviderAdapter {
  const capabilities = adapter.capabilities();
  return { ...adapter, capabilities: () => ({ ...capabilities, sources: capabilities.sources.map((source) => ({ ...source, chain: "base" as const })) }) };
}

const silentHop: HopPricer = {
  reachable: () => never(),
  exactInput: () => never(),
  exactOutput: () => never(),
};

describe("a provider or hop that never answers", () => {
  it("answers no_route within the rate deadline instead of hanging", async () => {
    const getRate = createRates({ adapters: sandboxAdapters().map(onBaseOnly), hop: silentHop, routing: DEFAULT_ROUTING_CONFIG, signals: NO_SIGNALS, now: () => START });
    const started = Date.now();
    await expect(getRate("usdc", "ngn", 50)).rejects.toMatchObject({ status: 422, code: "no_route" });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("drops a provider whose quote never comes back once the fan-out times out", async () => {
    const silent = sandboxAdapters().map((adapter) => ({ ...adapter, quote: () => never<Awaited<ReturnType<typeof adapter.quote>>>() }));
    const getRate = createRates({ adapters: silent, routing: { ...DEFAULT_ROUTING_CONFIG, fanOutMs: 20 }, signals: NO_SIGNALS, now: () => START });
    await expect(getRate("usdc", "ngn")).rejects.toMatchObject({ status: 422, code: "no_route" });
  });

  it("treats a hop that never says whether it reaches a chain as not reaching it", async () => {
    const getRate = createRates({ adapters: sandboxAdapters().map(onBaseOnly), hop: silentHop, routing: { ...DEFAULT_ROUTING_CONFIG, hopFanOutMs: 20 }, signals: NO_SIGNALS, now: () => START });
    await expect(getRate("usdc", "ngn")).rejects.toMatchObject({ status: 422, code: "no_route" });
  });
});

describe("quoteAndSave", () => {
  it("prices every provider before it opens a transaction", async () => {
    let priced = false;
    const slow = sandboxAdapters().map((adapter) => ({
      ...adapter,
      quote: async (...args: Parameters<typeof adapter.quote>) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        priced = true;
        return adapter.quote(...args);
      },
    }));
    let pricedWhenOpened: boolean | null = null;
    const unit = (async () => {
      pricedWhenOpened = priced;
      throw new Error("stop before writing");
    }) as Unit;
    const deps = { adapters: slow, routing: DEFAULT_ROUTING_CONFIG, signals: NO_SIGNALS, now: () => new Date() };
    await expect(quoteAndSave(unit, deps, "usr_1", { token: "usdc", currency: "ngn", amount: "50" })).rejects.toThrow("stop before writing");
    expect(pricedWhenOpened).toBe(true);
  });
});
