import { ASSET_DECIMALS, FIAT_DECIMALS, convertAtRate } from "../providers/money";
import type { Asset, Chain, Corridor, Fee, ProviderAdapter, ProviderId, ProviderQuote, QuoteAmount, SourceAsset } from "../providers/types";

export type Preference = "best_rate" | "most_reliable" | "fastest";
export type BreakerState = "closed" | "half_open" | "open";

export interface Weights {
  amount: number;
  reliability: number;
  speed: number;
}

export interface RoutingConfig {
  fanOutMs: number;
  // A route through 1Click waits on a real 1Click quote, which takes 2 to 17 seconds.
  hopFanOutMs: number;
  expiryMarginMs: number;
  maxTtlMs: number;
  routingFeeBps: bigint;
  weights: Record<Preference, Weights>;
  defaultReliability: number;
  priorOrders: number;
  halfOpenMaxSendUnits: bigint;
  unknownSettleSeconds: number;
  // Off-ramps settle in seconds to minutes. Speed scores linearly over this horizon so it cannot drown a real price difference.
  speedHorizonSeconds: number;
}

// Spec 8.3. Weights live in configuration so they can be tuned without a deploy.
export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  fanOutMs: 1_500,
  hopFanOutMs: 20_000,
  expiryMarginMs: 10_000,
  maxTtlMs: 120_000,
  routingFeeBps: 0n,
  weights: {
    best_rate: { amount: 0.7, reliability: 0.2, speed: 0.1 },
    most_reliable: { amount: 0.3, reliability: 0.6, speed: 0.1 },
    fastest: { amount: 0.3, reliability: 0.2, speed: 0.5 },
  },
  defaultReliability: 0.9,
  priorOrders: 10,
  halfOpenMaxSendUnits: 20_000_000n,
  unknownSettleSeconds: 120,
  speedHorizonSeconds: 900,
};

export interface Outcomes {
  successes: number;
  orders: number;
  publishedRate?: number;
}

export interface RoutingSignals {
  breaker(provider: ProviderId, corridor: Corridor): BreakerState;
  outcomes(provider: ProviderId, corridor: Corridor): Promise<Outcomes | null>;
}

export const NO_SIGNALS: RoutingSignals = { breaker: () => "closed", outcomes: async () => null };

// Prices a NEAR Intents hop: the same stablecoin moved from the sender's chain to one the provider accepts.
export interface HopPricer {
  reachable(asset: Asset, from: Chain, to: Chain): Promise<boolean>;
  exactInput(asset: Asset, from: Chain, to: Chain, amountIn: bigint): Promise<{ amountOut: bigint; seconds: number }>;
  exactOutput(asset: Asset, from: Chain, to: Chain, amountOut: bigint): Promise<{ amountIn: bigint; seconds: number }>;
}

export interface HopLeg {
  chain: Chain;
  amountIn: bigint;
  amountOut: bigint;
  seconds: number;
}

export interface RouteRequest {
  corridor: Corridor;
  source: SourceAsset;
  amount: QuoteAmount;
  preference: Preference;
  // Prices for display only (the public rate board): no payout follows, so providers that cannot be funded
  // the way a payout would fund them still show their price.
  display?: boolean;
}

export interface Breakdown {
  amount: number;
  reliability: number;
  speed: number;
  weights: Weights;
  halfOpen: boolean;
  total: number;
}

export interface Route {
  rank: number;
  kind: "direct" | "intents";
  hop: HopLeg | null;
  provider: ProviderId;
  providerQuote: ProviderQuote;
  amountIn: bigint;
  amountOutMinor: bigint;
  // Fiat minor units of the destination currency. "ours" is our routing fee, taken from the amount sent.
  fees: { provider: bigint; network: bigint; intents: bigint; ours: bigint };
  etaSeconds: number;
  expiresAt: Date;
  breakdown: Breakdown;
}

export interface Dropped {
  provider: ProviderId;
  reason: "corridor" | "source" | "limits" | "breaker_open" | "timeout" | "error" | "half_open_over_limit";
}

export interface RouteSet {
  routes: Route[];
  dropped: Dropped[];
  expiresAt: Date;
}

const BPS = 10_000n;

function withinLimits(adapter: ProviderAdapter, request: RouteRequest): boolean {
  const limit = adapter.capabilities().limits[request.corridor.currency];
  if (!limit) return true;
  const value = request.amount.side === "send" ? request.amount : null;
  if (limit.side === "send" && value) return value.units >= limit.min && value.units <= limit.max;
  if (limit.side === "receive" && request.amount.side === "receive") {
    return request.amount.minorUnits >= limit.min && request.amount.minorUnits <= limit.max;
  }
  return true;
}

function fundable(adapter: ProviderAdapter, request: RouteRequest, way: "direct" | "hop"): boolean {
  if (request.display) return true;
  const { funding } = adapter.capabilities();
  return funding ? funding[way] : true;
}

// 1Click only moves real funds, so a sandbox provider is never reached through a hop, not even for display.
function hoppable(adapter: ProviderAdapter, request: RouteRequest): boolean {
  return !adapter.capabilities().sandbox && fundable(adapter, request, "hop");
}

function accepts(adapter: ProviderAdapter, request: RouteRequest): Dropped["reason"] | null {
  const { corridors, sources } = adapter.capabilities();
  const { country, currency, payoutType } = request.corridor;
  if (!corridors.some((c) => c.country === country && c.currency === currency && c.payoutType === payoutType)) return "corridor";
  if (!sources.some((s) => s.asset === request.source.asset && s.chain === request.source.chain)) return "source";
  if (!fundable(adapter, request, "direct")) return "source";
  return withinLimits(adapter, request) ? null : "limits";
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms).unref?.());
}

// Our fee comes out of the amount sent. In receive-exactly mode the sender pays enough that the provider still gets what it needs.
function splitOurFee(request: RouteRequest, bps: bigint): { providerAmount: QuoteAmount; ourFee: (providerSend: bigint) => { gross: bigint; ours: bigint } } {
  if (request.amount.side === "send") {
    const gross = request.amount.units;
    const ours = (gross * bps) / BPS;
    return { providerAmount: { side: "send", units: gross - ours }, ourFee: () => ({ gross, ours }) };
  }
  return {
    providerAmount: request.amount,
    ourFee: (providerSend) => {
      const gross = (providerSend * BPS + (BPS - bps) - 1n) / (BPS - bps);
      return { gross, ours: gross - providerSend };
    },
  };
}

function toFiat(fee: Fee, request: RouteRequest, rate: string): bigint {
  if (fee.unit === request.corridor.currency) return fee.amount;
  return convertAtRate(fee.amount, ASSET_DECIMALS[request.source.asset], rate, FIAT_DECIMALS[request.corridor.currency]);
}

function normalize(quote: ProviderQuote, request: RouteRequest, config: RoutingConfig, plan: ReturnType<typeof splitOurFee>, hop: HopLeg | null) {
  const decimals = ASSET_DECIMALS[request.source.asset];
  const fiatDecimals = FIAT_DECIMALS[request.corridor.currency];
  // What the sender's side must cover before our fee: the provider's amount, or the hop's input when there is a hop.
  const { gross, ours } = plan.ourFee(hop ? hop.amountIn : quote.sendUnits);
  const sum = (kind: Fee["kind"]) =>
    quote.fees.filter((fee) => fee.kind === kind).reduce((total, fee) => total + toFiat(fee, request, quote.rate), 0n);
  return {
    amountIn: gross,
    amountOutMinor: quote.receiveMinorUnits,
    fees: {
      provider: sum("provider"),
      network: sum("network"),
      intents: hop ? convertAtRate(hop.amountIn - hop.amountOut, decimals, quote.rate, fiatDecimals) : 0n,
      ours: convertAtRate(ours, decimals, quote.rate, fiatDecimals),
    },
    etaSeconds: (quote.estimatedSettleSeconds ?? config.unknownSettleSeconds) + (hop?.seconds ?? 0),
  };
}

function smoothed(outcomes: Outcomes | null, config: RoutingConfig): number {
  const prior = outcomes?.publishedRate ?? config.defaultReliability;
  const orders = outcomes?.orders ?? 0;
  const successes = outcomes?.successes ?? 0;
  return (successes + config.priorOrders * prior) / (orders + config.priorOrders);
}

// The first chain this provider accepts for the asset that the hop can reach from the sender's chain.
// A hop that cannot say whether it reaches a chain in time counts as not reaching it.
async function hopChain(adapter: ProviderAdapter, request: RouteRequest, hop: HopPricer, waitMs: number): Promise<Chain | null> {
  for (const source of adapter.capabilities().sources) {
    if (source.asset !== request.source.asset || source.chain === request.source.chain) continue;
    const reachable = await Promise.race([hop.reachable(source.asset, request.source.chain, source.chain), timeout(waitMs)]).catch(() => false);
    if (reachable) return source.chain;
  }
  return null;
}

async function priceRoute(
  adapter: ProviderAdapter,
  request: RouteRequest,
  plan: ReturnType<typeof splitOurFee>,
  via: Chain | null,
  hop: HopPricer | undefined,
): Promise<{ quote: ProviderQuote; leg: HopLeg | null }> {
  const base = { quoteId: "pending", corridor: request.corridor };
  if (!via || !hop) {
    return { quote: await adapter.quote({ ...base, source: request.source, amount: plan.providerAmount }), leg: null };
  }
  const { asset, chain: from } = request.source;
  const source = { asset, chain: via };
  if (plan.providerAmount.side === "send") {
    const priced = await hop.exactInput(asset, from, via, plan.providerAmount.units);
    const quote = await adapter.quote({ ...base, source, amount: { side: "send", units: priced.amountOut } });
    return { quote, leg: { chain: via, amountIn: plan.providerAmount.units, amountOut: priced.amountOut, seconds: priced.seconds } };
  }
  const quote = await adapter.quote({ ...base, source, amount: plan.providerAmount });
  const priced = await hop.exactOutput(asset, from, via, quote.sendUnits);
  return { quote, leg: { chain: via, amountIn: priced.amountIn, amountOut: quote.sendUnits, seconds: priced.seconds } };
}

export async function quoteRoutes(
  adapters: readonly ProviderAdapter[],
  request: RouteRequest,
  config: RoutingConfig = DEFAULT_ROUTING_CONFIG,
  signals: RoutingSignals = NO_SIGNALS,
  now: Date = new Date(),
  hop?: HopPricer,
): Promise<RouteSet> {
  const dropped: Dropped[] = [];
  const candidates: { adapter: ProviderAdapter; state: BreakerState; via: Chain | null }[] = [];
  for (const adapter of adapters) {
    let refusal = accepts(adapter, request);
    let via: Chain | null = null;
    if (refusal === "source" && hop && hoppable(adapter, request)) {
      via = await hopChain(adapter, request, hop, config.hopFanOutMs);
      if (via) refusal = withinLimits(adapter, request) ? null : "limits";
    }
    const state = signals.breaker(adapter.id, request.corridor);
    if (refusal) dropped.push({ provider: adapter.id, reason: refusal });
    else if (state === "open") dropped.push({ provider: adapter.id, reason: "breaker_open" });
    else candidates.push({ adapter, state, via });
  }

  const plan = splitOurFee(request, config.routingFeeBps);
  const quoted = await Promise.all(
    candidates.map(async ({ adapter, state, via }) => {
      try {
        const priced = await Promise.race([priceRoute(adapter, request, plan, via, hop), timeout(via ? config.hopFanOutMs : config.fanOutMs)]);
        return { adapter, state, ...priced };
      } catch (error) {
        dropped.push({ provider: adapter.id, reason: (error as Error).message === "timeout" ? "timeout" : "error" });
        return null;
      }
    }),
  );

  const offered = [];
  for (const entry of quoted) {
    if (!entry) continue;
    const normalized = normalize(entry.quote, request, config, plan, entry.leg);
    if (entry.state === "half_open" && normalized.amountIn >= config.halfOpenMaxSendUnits) {
      dropped.push({ provider: entry.adapter.id, reason: "half_open_over_limit" });
      continue;
    }
    offered.push({ ...entry, ...normalized });
  }

  const bestOut = offered.reduce((max, o) => (o.amountOutMinor > max ? o.amountOutMinor : max), 0n);
  const weights = config.weights[request.preference];
  const scored = await Promise.all(
    offered.map(async (o) => {
      const amount = bestOut === 0n ? 0 : Number((o.amountOutMinor * 1_000_000n) / bestOut) / 1_000_000;
      const reliability = smoothed(await signals.outcomes(o.adapter.id, request.corridor), config);
      const speed = Math.max(0, 1 - o.etaSeconds / config.speedHorizonSeconds);
      const halfOpen = o.state === "half_open";
      const total = (weights.amount * amount + weights.reliability * reliability + weights.speed * speed) * (halfOpen ? 0.5 : 1);
      return { o, breakdown: { amount, reliability, speed, weights, halfOpen, total } };
    }),
  );

  scored.sort((a, b) => b.breakdown.total - a.breakdown.total || Number(b.o.amountOutMinor - a.o.amountOutMinor) || a.o.adapter.id.localeCompare(b.o.adapter.id));

  const earliest = scored.reduce((min, { o }) => Math.min(min, o.quote.expiresAt.getTime()), Number.POSITIVE_INFINITY);
  const expiresAt = new Date(Math.min(now.getTime() + config.maxTtlMs, earliest - config.expiryMarginMs));

  return {
    routes: scored.map(({ o, breakdown }, index) => ({
      rank: index + 1,
      kind: o.leg ? ("intents" as const) : ("direct" as const),
      hop: o.leg,
      provider: o.adapter.id,
      providerQuote: o.quote,
      amountIn: o.amountIn,
      amountOutMinor: o.amountOutMinor,
      fees: o.fees,
      etaSeconds: o.etaSeconds,
      expiresAt: new Date(Math.min(o.quote.expiresAt.getTime() - config.expiryMarginMs, now.getTime() + config.maxTtlMs)),
      breakdown,
    })),
    dropped,
    expiresAt,
  };
}
