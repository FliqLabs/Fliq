import { newId } from "../../../packages/db/src/ids.js";
import { quoteRoutes, type Dropped, type Route } from "../../../packages/domain/routing.js";
import type { Asset, Chain, FiatCurrency } from "../../../packages/providers/types.js";
import type { Unit } from "./db.js";
import { invalidRequest } from "./errors.js";
import { COUNTRY, rateOf, total, type QuoteDeps, type QuoteInput } from "./quotes.js";
import { referencePayoutType } from "./rates.js";

export const BOARD_TTL_MS = 10_000;
// The same reference payout as GET /rates: 100 tokens in 6-decimal units.
const REFERENCE_UNITS = 100_000_000n;
const TOKENS: readonly string[] = ["usdc", "usdt"];
const KEEP_MS = 90 * 24 * 60 * 60_000;

export const SAMPLED_CORRIDORS: readonly { token: QuoteInput["token"]; currency: QuoteInput["currency"] }[] = [
  { token: "usdc", currency: "ngn" },
  { token: "usdt", currency: "ngn" },
  { token: "usdc", currency: "kes" },
  { token: "usdt", currency: "kes" },
  { token: "usdc", currency: "ghs" },
  { token: "usdc", currency: "idr" },
  { token: "usdc", currency: "php" },
];

export const RANGES = {
  "24h": { spanMs: 24 * 60 * 60_000, intervalSeconds: 900 },
  "7d": { spanMs: 7 * 24 * 60 * 60_000, intervalSeconds: 3_600 },
  "30d": { spanMs: 30 * 24 * 60 * 60_000, intervalSeconds: 14_400 },
} as const;
export type RangeId = keyof typeof RANGES;

const NOT_OFFERED: Partial<Record<Dropped["reason"], "breaker_open" | "half_open_over_limit" | "timeout" | "error">> = {
  breaker_open: "breaker_open",
  half_open_over_limit: "half_open_over_limit",
  timeout: "timeout",
  error: "error",
};

const round2 = (value: number) => Math.round(value * 100) / 100;

function priced(route: Route, at: Date) {
  const fee = total(route);
  return {
    provider: route.provider,
    status: "live" as const,
    rate: rateOf(route.amountOutMinor, route.amountIn),
    rate_before_fees: rateOf(route.amountOutMinor + fee, route.amountIn),
    fee: Number(fee) / 100,
    fee_percent: round2((Number(fee) / Number(route.amountOutMinor + fee)) * 100),
    receive: Number(route.amountOutMinor / 100n),
    eta_seconds: route.etaSeconds,
    on_time_percent: Math.round(route.breakdown.reliability * 100),
    updated_at: at.toISOString(),
    not_offered_reason: null,
  };
}

function corridorOf(token: string, currency: string) {
  if (!TOKENS.includes(token)) throw invalidRequest(`Unsupported token ${token}.`);
  if (!Object.hasOwn(COUNTRY, currency)) throw invalidRequest(`Unsupported currency ${currency}.`);
  return { token: token as QuoteInput["token"], currency: currency as QuoteInput["currency"] };
}

export function createRateBoard(deps: QuoteDeps, unit: Unit) {
  const cache = new Map<string, { value: Promise<{ routes: Route[]; dropped: Dropped[]; at: Date }>; expiresAt: number }>();

  // One pass over every provider per corridor every 10 seconds, however many visitors or samples ask for it.
  function routesFor(token: QuoteInput["token"], currency: QuoteInput["currency"]) {
    const key = `${token}:${currency}`;
    const nowMs = deps.now().getTime();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > nowMs) return cached.value;
    const at = deps.now();
    const value = quoteRoutes(
      deps.adapters,
      {
        corridor: { country: COUNTRY[currency], currency: currency.toUpperCase() as FiatCurrency, payoutType: referencePayoutType(currency) },
        source: { asset: token.toUpperCase() as Asset, chain: "near" as Chain },
        amount: { side: "send", units: REFERENCE_UNITS },
        preference: "best_rate",
        display: true,
      },
      deps.routing,
      deps.signals,
      at,
      deps.hop,
    ).then(({ routes, dropped }) => ({ routes, dropped, at }));
    cache.set(key, { value, expiresAt: nowMs + BOARD_TTL_MS });
    value.catch(() => {
      if (cache.get(key)?.value === value) cache.delete(key);
    });
    return value;
  }

  async function board(rawToken: string, rawCurrency: string) {
    const { token, currency } = corridorOf(rawToken, rawCurrency);
    const { routes, dropped, at } = await routesFor(token, currency);
    const missing = dropped.flatMap((drop) => {
      const reason = NOT_OFFERED[drop.reason];
      return reason ? [{ provider: drop.provider, reason }] : [];
    });
    const last = missing.length
      ? await unit((tx) =>
          tx.rateSample.findMany({
            where: { token, currency, provider: { in: missing.map((item) => item.provider) } },
            orderBy: { sampledAt: "desc" },
            distinct: ["provider"],
          }),
        )
      : [];

    const unanswered = missing.map(({ provider, reason }) => {
      const sample = last.find((row) => row.provider === provider);
      const paused = reason === "breaker_open" || reason === "half_open_over_limit";
      const blank = { rate: null, rate_before_fees: null, fee: null, fee_percent: null, receive: null, eta_seconds: null, on_time_percent: null, updated_at: null };
      const known = sample
        ? {
            rate: Number(sample.rate),
            rate_before_fees: Number(sample.rateBeforeFees),
            fee: Number(sample.feeMinor) / 100,
            fee_percent: round2((Number(sample.feeMinor) / Number(sample.receiveMinor + sample.feeMinor)) * 100),
            receive: Number(sample.receiveMinor / 100n),
            eta_seconds: sample.etaSeconds,
            on_time_percent: sample.onTimePercent,
            updated_at: sample.sampledAt.toISOString(),
          }
        : blank;
      return { provider, status: paused ? ("paused" as const) : ("stale" as const), ...(paused ? blank : known), not_offered_reason: reason };
    });

    return {
      token,
      currency,
      amount: "100.00",
      best: routes[0]?.provider ?? null,
      fetched_at: at.toISOString(),
      providers: [
        ...routes.map((route) => priced(route, at)),
        ...unanswered.filter((row) => row.status === "stale"),
        ...unanswered.filter((row) => row.status === "paused"),
      ],
    };
  }

  // Each period's best and worst are the averages of the best and worst provider in every minute sampled.
  async function history(rawToken: string, rawCurrency: string, rawRange: string | undefined) {
    const { token, currency } = corridorOf(rawToken, rawCurrency);
    const range = (rawRange ?? "24h") as RangeId;
    if (!Object.hasOwn(RANGES, range)) throw invalidRequest("range must be 24h, 7d or 30d.");
    const { spanMs, intervalSeconds } = RANGES[range];
    const since = new Date(deps.now().getTime() - spanMs);
    const rows = await unit((tx) => tx.$queryRaw<{ at: Date; best: number; worst: number }[]>`
      WITH minutes AS (
        SELECT sampled_at, max(rate) AS best, min(rate) AS worst
        FROM core.rate_samples
        WHERE token = ${token} AND currency = ${currency} AND sampled_at >= ${since}
        GROUP BY sampled_at
      )
      SELECT to_timestamp(floor(extract(epoch FROM sampled_at) / ${intervalSeconds}) * ${intervalSeconds}) AS at,
             round(avg(best), 4)::float8 AS best,
             round(avg(worst), 4)::float8 AS worst
      FROM minutes
      GROUP BY 1
      ORDER BY 1`);
    return {
      token,
      currency,
      range,
      interval_seconds: intervalSeconds,
      points: rows.map((row) => ({ at: row.at.toISOString(), best: row.best, worst: row.worst, p2p: null })),
    };
  }

  // Every provider that quoted, at one shared timestamp per corridor so a minute's best and worst line up.
  async function sample(): Promise<number> {
    let written = 0;
    for (const { token, currency } of SAMPLED_CORRIDORS) {
      const result = await routesFor(token, currency).catch(() => null);
      if (!result || result.routes.length === 0) continue;
      const sampledAt = deps.now();
      const created = await unit((tx) =>
        tx.rateSample.createMany({
          data: result.routes.map((route) => ({
            id: newId("rs"),
            token,
            currency,
            provider: route.provider,
            rate: rateOf(route.amountOutMinor, route.amountIn).toFixed(4),
            rateBeforeFees: rateOf(route.amountOutMinor + total(route), route.amountIn).toFixed(4),
            feeMinor: total(route),
            receiveMinor: route.amountOutMinor,
            etaSeconds: route.etaSeconds,
            onTimePercent: Math.round(route.breakdown.reliability * 100),
            sampledAt,
          })),
        }),
      );
      written += created.count;
    }
    return written;
  }

  async function prune(): Promise<number> {
    const { count } = await unit((tx) => tx.rateSample.deleteMany({ where: { sampledAt: { lt: new Date(deps.now().getTime() - KEEP_MS) } } }));
    return count;
  }

  return { board, history, sample, prune };
}

export type RateBoard = ReturnType<typeof createRateBoard>;

// One sample a minute, never overlapping; history older than 90 days is dropped once an hour.
export function startRateSampler(board: RateBoard, intervalMs = 60_000): () => void {
  let running = false;
  let lastPrune = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await board.sample();
      if (Date.now() - lastPrune > 60 * 60_000) {
        await board.prune();
        lastPrune = Date.now();
      }
    } catch (error) {
      console.error("[rates] sample failed", (error as Error).name);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
