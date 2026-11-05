import type { Prisma } from "@prisma/client";
import {
  quoteRoutes,
  type Dropped,
  type Preference,
  type Route,
  type RoutingConfig,
  type RoutingSignals,
} from "../../../packages/domain/routing.js";
import { newId } from "../../../packages/db/src/ids.js";
import { InvalidAmountError, toUnits } from "../../../packages/providers/money.js";
import type { Asset, Chain, Country, FiatCurrency, PayoutType, ProviderAdapter, QuoteAmount } from "../../../packages/providers/types.js";
import { formatTokenAmount } from "./dashboard.js";
import type { Db } from "./db.js";
import { ApiError, invalidRequest } from "./errors.js";

export interface QuoteDeps {
  adapters: readonly ProviderAdapter[];
  routing: RoutingConfig;
  signals: RoutingSignals;
  now: () => Date;
}

export interface QuoteInput {
  token: "usdc" | "usdt";
  currency: "ngn" | "kes" | "ghs" | "idr" | "php";
  amount: string;
  payout_type?: PayoutType;
  source_chain?: string;
  mode?: "send" | "receive";
  preference?: Preference;
}

const COUNTRY: Record<QuoteInput["currency"], Country> = { ngn: "NG", kes: "KE", ghs: "GH", idr: "ID", php: "PH" };
const NOT_OFFERED: Partial<Record<Dropped["reason"], "breaker_open" | "timeout" | "error" | "half_open_over_limit">> = {
  breaker_open: "breaker_open",
  timeout: "timeout",
  error: "error",
  half_open_over_limit: "half_open_over_limit",
};

function parseAmount(input: QuoteInput): QuoteAmount {
  try {
    if (input.mode === "receive") return { side: "receive", minorUnits: toUnits(input.amount, 2) };
    return { side: "send", units: toUnits(input.amount, 6) };
  } catch (error) {
    if (error instanceof InvalidAmountError) throw invalidRequest(error.message);
    throw error;
  }
}

// Whole units to four decimals, from integers: minor units per token is (minor / 100) / (units / 1e6).
const rateOf = (minor: bigint, amountIn: bigint) => Number((minor * 10n ** 8n) / amountIn) / 10_000;
const wholeUnits = (minor: bigint) => Number(minor / 100n);
const total = (route: Route) => route.fees.provider + route.fees.network + route.fees.intents + route.fees.ours;

async function developerIdFor(tx: Db, userId: string): Promise<string> {
  const workspace = await tx.workspace.findFirst({ where: { ownerId: userId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  return workspace?.id ?? userId;
}

export async function requestQuote(tx: Db, deps: QuoteDeps, userId: string, input: QuoteInput) {
  const amount = parseAmount(input);
  const requested = amount.side === "send" ? amount.units : amount.minorUnits;
  if (requested <= 0n) throw invalidRequest("amount must be greater than zero.");

  const now = deps.now();
  const currency = input.currency.toUpperCase() as FiatCurrency;
  const { routes, dropped, expiresAt } = await quoteRoutes(
    deps.adapters,
    {
      corridor: { country: COUNTRY[input.currency], currency, payoutType: input.payout_type ?? "bank" },
      source: { asset: input.token.toUpperCase() as Asset, chain: (input.source_chain ?? "near").toLowerCase() as Chain },
      amount,
      preference: input.preference ?? "best_rate",
    },
    deps.routing,
    deps.signals,
    now,
  );
  const best = routes[0];
  if (!best || expiresAt <= now) throw new ApiError(422, "no_route", "No provider can pay this out right now.");

  const quoteId = newId("q");
  const routeIds = routes.map(() => newId("qr"));
  await tx.quote.create({
    data: {
      id: quoteId,
      developerId: await developerIdFor(tx, userId),
      mode: input.mode === "receive" ? "receive_exactly" : "send_exactly",
      tokenSymbol: input.token.toUpperCase(),
      sourceChain: (input.source_chain ?? "near").toLowerCase(),
      currency: input.currency,
      amountIn: best.amountIn,
      amountOutMinor: best.amountOutMinor,
      rate: (Number(rateOf(best.amountOutMinor, best.amountIn)) || 0).toFixed(10),
      chosenRouteId: routeIds[0] ?? null,
      expiresAt,
    },
  });
  await tx.quoteRoute.createMany({
    data: routes.map((route, index) => ({
      id: routeIds[index] as string,
      quoteId,
      provider: route.provider,
      kind: "direct" as const,
      rank: route.rank,
      amountIn: route.amountIn,
      amountOutMinor: route.amountOutMinor,
      rate: rateOf(route.amountOutMinor, route.amountIn).toFixed(10),
      feeProvider: route.fees.provider,
      feeNetwork: route.fees.network,
      feeIntents: route.fees.intents,
      feeOurs: route.fees.ours,
      etaSeconds: route.etaSeconds,
      expiresAt: route.expiresAt,
      scoreBreakdown: route.breakdown as unknown as Prisma.InputJsonObject,
    })),
  });

  const next = routes[1];
  return {
    quote_id: quoteId,
    token: input.token,
    currency: input.currency,
    amount: formatTokenAmount(best.amountIn),
    rate_before_fees: rateOf(best.amountOutMinor + total(best), best.amountIn),
    fees: { provider: Number(best.fees.provider), network: Number(best.fees.network), total: Number(total(best)) },
    rate: rateOf(best.amountOutMinor, best.amountIn),
    receive: wholeUnits(best.amountOutMinor),
    provider: best.provider,
    best_of: routes.length,
    routes: [
      ...routes.map((route) => ({
        provider: route.provider,
        status: "live" as const,
        rate: rateOf(route.amountOutMinor, route.amountIn),
        age_seconds: 0,
        routed: route.rank === 1,
        receive: wholeUnits(route.amountOutMinor),
        fee: Number(total(route)),
        eta_seconds: route.etaSeconds,
        on_time_percent: Math.round(route.breakdown.reliability * 100),
        less_than_best: wholeUnits(best.amountOutMinor - route.amountOutMinor),
        not_offered_reason: null,
      })),
      ...dropped.flatMap((drop) => {
        const reason = NOT_OFFERED[drop.reason];
        if (!reason) return [];
        return [{
          provider: drop.provider,
          status: reason === "breaker_open" || reason === "half_open_over_limit" ? ("paused" as const) : ("stale" as const),
          rate: null,
          routed: false,
          not_offered_reason: reason,
        }];
      }),
    ],
    expires_in: Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)),
    eta_seconds: best.etaSeconds,
    saving_vs_next: next ? wholeUnits(best.amountOutMinor - next.amountOutMinor) : 0,
  };
}
