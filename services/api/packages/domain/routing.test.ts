import { describe, expect, it } from "vitest";
import { createMockProvider } from "../providers/mock/mock";
import type { Capabilities, ProviderAdapter, ProviderId, ProviderQuote } from "../providers/types";
import { DEFAULT_ROUTING_CONFIG, quoteRoutes, type HopPricer, type RouteRequest, type RoutingSignals } from "./routing";

const now = new Date("2026-11-05T10:00:00Z");
const deps = { alert: () => undefined, now: () => now };
const mock = createMockProvider({ deps, webhookSecret: "test" }).adapter;

const request: RouteRequest = {
  corridor: { country: "NG", currency: "NGN", payoutType: "bank" },
  source: { asset: "USDC", chain: "simulated" },
  amount: { side: "send", units: 50_000_000n },
  preference: "best_rate",
};

// A stand-in provider built on the mock, with its own price, speed and behaviour.
function provider(id: ProviderId, options: { receiveMinor?: bigint; seconds?: number; ttlMs?: number; delayMs?: number; fail?: boolean; capabilities?: Partial<Capabilities> }): ProviderAdapter {
  return {
    ...mock,
    id,
    capabilities: () => ({ ...mock.capabilities(), provider: id, ...options.capabilities }),
    async quote(req): Promise<ProviderQuote> {
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      if (options.fail) throw new Error("upstream down");
      const base = await mock.quote(req);
      return {
        ...base,
        provider: id,
        receiveMinorUnits: options.receiveMinor ?? base.receiveMinorUnits,
        estimatedSettleSeconds: options.seconds ?? base.estimatedSettleSeconds,
        expiresAt: new Date(now.getTime() + (options.ttlMs ?? 90_000)),
      };
    },
  };
}

describe("a quote against the mock provider", () => {
  it("reproduces the canonical fixture to the unit", async () => {
    const { routes, expiresAt } = await quoteRoutes([mock], request, DEFAULT_ROUTING_CONFIG, undefined, now);
    const route = routes[0];
    expect(route).toMatchObject({ rank: 1, provider: "mock", amountIn: 50_000_000n, amountOutMinor: 6_881_600n, etaSeconds: 21 });
    expect(route?.fees).toEqual({ provider: 25_000n, network: 9_400n, intents: 0n, ours: 0n });
    expect(expiresAt).toEqual(new Date(now.getTime() + 80_000));
  });

  it("works in receive-exactly mode and never falls short", async () => {
    const { routes } = await quoteRoutes([mock], { ...request, amount: { side: "receive", minorUnits: 6_881_600n } });
    expect(routes[0]?.amountOutMinor).toBeGreaterThanOrEqual(6_881_600n);
    expect(routes[0]?.amountIn).toBe(50_000_000n);
  });
});

describe("candidate filter", () => {
  it("drops providers that do not serve the corridor or accept the source", async () => {
    const kenyaOnly = provider("busha", { capabilities: { corridors: [{ country: "KE", currency: "KES", payoutType: "bank" }] } });
    const wrongChain = provider("fonbnk", { capabilities: { sources: [{ asset: "USDC", chain: "base" }] } });
    const { routes, dropped } = await quoteRoutes([mock, kenyaOnly, wrongChain], request);
    expect(routes.map((r) => r.provider)).toEqual(["mock"]);
    expect(dropped).toEqual(expect.arrayContaining([{ provider: "busha", reason: "corridor" }, { provider: "fonbnk", reason: "source" }]));
  });

  it("drops a provider whose limits exclude the amount", async () => {
    const strict = provider("transfi", { capabilities: { limits: { NGN: { side: "send", min: 100_000_000n, max: 200_000_000n } } } });
    expect((await quoteRoutes([mock, strict], request)).dropped).toContainEqual({ provider: "transfi", reason: "limits" });
  });

  it("drops a provider with an open breaker", async () => {
    const signals: RoutingSignals = { breaker: (id) => (id === "busha" ? "open" : "closed"), outcomes: async () => null };
    const { routes, dropped } = await quoteRoutes([mock, provider("busha", {})], request, DEFAULT_ROUTING_CONFIG, signals);
    expect(routes.map((r) => r.provider)).toEqual(["mock"]);
    expect(dropped).toContainEqual({ provider: "busha", reason: "breaker_open" });
  });
});

describe("fan-out budget", () => {
  it("drops a slow provider and a failing one without failing the quote", async () => {
    const config = { ...DEFAULT_ROUTING_CONFIG, fanOutMs: 50 };
    const started = Date.now();
    const { routes, dropped } = await quoteRoutes(
      [mock, provider("busha", { delayMs: 500 }), provider("fonbnk", { fail: true })],
      request,
      config,
      undefined,
      now,
    );
    expect(Date.now() - started).toBeLessThan(400);
    expect(routes.map((r) => r.provider)).toEqual(["mock"]);
    expect(dropped).toEqual(expect.arrayContaining([{ provider: "busha", reason: "timeout" }, { provider: "fonbnk", reason: "error" }]));
  });
});

describe("scoring", () => {
  const cheap = provider("paycrest", { receiveMinor: 6_881_600n, seconds: 60 });
  const dear = provider("busha", { receiveMinor: 6_850_400n, seconds: 40 });
  const quick = provider("fonbnk", { receiveMinor: 6_792_000n, seconds: 5 });

  it("ranks by amount received under best_rate and explains why with the stored breakdown", async () => {
    const { routes } = await quoteRoutes([quick, dear, cheap], request);
    expect(routes.map((r) => r.provider)).toEqual(["paycrest", "busha", "fonbnk"]);
    const winner = routes[0]?.breakdown;
    expect(winner?.amount).toBe(1);
    expect(winner?.total).toBeCloseTo(0.7 * 1 + 0.2 * 0.9 + 0.1 * (1 - 60 / 900), 5);
    expect(routes[0]?.breakdown.total).toBeGreaterThan(routes[1]?.breakdown.total ?? 1);
  });

  it("lets speed win under the fastest preference", async () => {
    const { routes } = await quoteRoutes([cheap, dear, quick], { ...request, preference: "fastest" });
    expect(routes[0]?.provider).toBe("fonbnk");
  });

  it("lets reliability win under most_reliable when history differs", async () => {
    const signals: RoutingSignals = {
      breaker: () => "closed",
      outcomes: async (id) => (id === "busha" ? { successes: 990, orders: 1000 } : { successes: 500, orders: 1000 }),
    };
    const { routes } = await quoteRoutes([cheap, dear], { ...request, preference: "most_reliable" }, DEFAULT_ROUTING_CONFIG, signals);
    expect(routes[0]?.provider).toBe("busha");
  });

  it("smooths a new provider toward the published rate instead of trusting a tiny sample", async () => {
    const signals: RoutingSignals = { breaker: () => "closed", outcomes: async () => ({ successes: 1, orders: 1, publishedRate: 0.8 }) };
    const { routes } = await quoteRoutes([cheap], request, DEFAULT_ROUTING_CONFIG, signals);
    expect(routes[0]?.breakdown.reliability).toBeCloseTo((1 + 10 * 0.8) / 11, 6);
  });

  it("halves a half-open route and only offers it under 20 USD", async () => {
    const signals: RoutingSignals = { breaker: (id) => (id === "paycrest" ? "half_open" : "closed"), outcomes: async () => null };
    const big = await quoteRoutes([cheap, dear], request, DEFAULT_ROUTING_CONFIG, signals);
    expect(big.routes.map((r) => r.provider)).toEqual(["busha"]);
    expect(big.dropped).toContainEqual({ provider: "paycrest", reason: "half_open_over_limit" });

    const small = await quoteRoutes([cheap, dear], { ...request, amount: { side: "send", units: 10_000_000n } }, DEFAULT_ROUTING_CONFIG, signals);
    const halved = small.routes.find((r) => r.provider === "paycrest");
    expect(halved?.breakdown.halfOpen).toBe(true);
    expect(halved?.breakdown.total).toBeLessThan(0.5);
  });
});

describe("expiry", () => {
  it("is the earliest upstream expiry minus 10 seconds, capped at 120", async () => {
    const short = provider("busha", { ttlMs: 30_000 });
    expect((await quoteRoutes([mock, short], request, DEFAULT_ROUTING_CONFIG, undefined, now)).expiresAt).toEqual(new Date(now.getTime() + 20_000));
    const long = provider("busha", { ttlMs: 600_000 });
    expect((await quoteRoutes([long], request, DEFAULT_ROUTING_CONFIG, undefined, now)).expiresAt).toEqual(new Date(now.getTime() + 120_000));
  });
});

describe("our routing fee", () => {
  it("comes out of the amount sent in send mode", async () => {
    const config = { ...DEFAULT_ROUTING_CONFIG, routingFeeBps: 30n };
    const { routes } = await quoteRoutes([mock], request, config);
    expect(routes[0]?.amountIn).toBe(50_000_000n);
    expect(routes[0]?.providerQuote.sendUnits).toBe(49_850_000n);
    expect(routes[0]?.fees.ours).toBeGreaterThan(0n);
  });

  it("is added on top in receive mode so the provider still gets what it needs", async () => {
    const config = { ...DEFAULT_ROUTING_CONFIG, routingFeeBps: 30n };
    const { routes } = await quoteRoutes([mock], { ...request, amount: { side: "receive", minorUnits: 6_881_600n } }, config);
    const route = routes[0];
    expect(route?.amountIn).toBeGreaterThan(route?.providerQuote.sendUnits ?? 0n);
    expect(route?.amountOutMinor).toBeGreaterThanOrEqual(6_881_600n);
  });
});

describe("a route through a NEAR Intents hop", () => {
  const nearRequest: RouteRequest = { ...request, source: { asset: "USDC", chain: "near" } };
  // Accepts USDC on Base only, as Paycrest does, so a sender on NEAR needs the hop.
  const baseOnly = provider("paycrest", { capabilities: { sources: [{ asset: "USDC", chain: "base" }] } });
  const hop: HopPricer = {
    reachable: async (_asset, from, to) => from === "near" && to === "base",
    exactInput: async (_asset, _from, _to, amountIn) => ({ amountOut: (amountIn * 999n) / 1000n, seconds: 30 }),
    exactOutput: async (_asset, _from, _to, amountOut) => ({ amountIn: (amountOut * 1000n + 998n) / 999n, seconds: 30 }),
  };

  it("prices the hop first and the provider on what arrives", async () => {
    const { routes } = await quoteRoutes([baseOnly], nearRequest, DEFAULT_ROUTING_CONFIG, undefined, now, hop);
    const route = routes[0];
    expect(route).toMatchObject({ kind: "intents", provider: "paycrest", amountIn: 50_000_000n, etaSeconds: 51 });
    expect(route?.hop).toEqual({ chain: "base", amountIn: 50_000_000n, amountOut: 49_950_000n, seconds: 30 });
    expect(route?.providerQuote.sendUnits).toBe(49_950_000n);
    expect(route?.fees.intents).toBeGreaterThan(0n);
    expect(route?.amountOutMinor).toBeLessThan(6_881_600n);
  });

  it("solves for the sender's side in receive-exactly mode", async () => {
    const { routes } = await quoteRoutes([baseOnly], { ...nearRequest, amount: { side: "receive", minorUnits: 6_881_600n } }, DEFAULT_ROUTING_CONFIG, undefined, now, hop);
    const route = routes[0];
    expect(route?.amountOutMinor).toBeGreaterThanOrEqual(6_881_600n);
    expect(route?.amountIn).toBeGreaterThan(route?.hop?.amountOut ?? 0n);
    expect(route?.hop?.amountIn).toBe(route?.amountIn);
  });

  it("drops the provider when there is no hop pricer, no path, or the hop fails", async () => {
    expect((await quoteRoutes([baseOnly], nearRequest, DEFAULT_ROUTING_CONFIG, undefined, now)).dropped).toContainEqual({ provider: "paycrest", reason: "source" });
    const noPath: HopPricer = { ...hop, reachable: async () => false };
    expect((await quoteRoutes([baseOnly], nearRequest, DEFAULT_ROUTING_CONFIG, undefined, now, noPath)).dropped).toContainEqual({ provider: "paycrest", reason: "source" });
    const broken: HopPricer = { ...hop, exactInput: async () => Promise.reject(new Error("1click down")) };
    expect((await quoteRoutes([baseOnly], nearRequest, DEFAULT_ROUTING_CONFIG, undefined, now, broken)).dropped).toContainEqual({ provider: "paycrest", reason: "error" });
  });

  it("ranks a direct route above a hopped one that pays less", async () => {
    const direct = provider("busha", { capabilities: { sources: [{ asset: "USDC", chain: "near" }] } });
    const { routes } = await quoteRoutes([baseOnly, direct], nearRequest, DEFAULT_ROUTING_CONFIG, undefined, now, hop);
    expect(routes.map((r) => [r.provider, r.kind])).toEqual([
      ["busha", "direct"],
      ["paycrest", "intents"],
    ]);
  });

  it("waits longer for a hopped route than for a direct one", async () => {
    const slowHop: HopPricer = {
      ...hop,
      exactInput: async (...args) => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return hop.exactInput(...args);
      },
    };
    const slowDirect = provider("busha", { delayMs: 150, capabilities: { sources: [{ asset: "USDC", chain: "near" }] } });
    const config = { ...DEFAULT_ROUTING_CONFIG, fanOutMs: 50, hopFanOutMs: 1_000 };
    const { routes, dropped } = await quoteRoutes([baseOnly, slowDirect], nearRequest, config, undefined, now, slowHop);
    expect(routes.map((r) => [r.provider, r.kind])).toEqual([["paycrest", "intents"]]);
    expect(dropped).toContainEqual({ provider: "busha", reason: "timeout" });
  });
});
