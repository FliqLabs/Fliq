import type { Prisma } from "@prisma/client";
import {
  quoteRoutes,
  type Dropped,
  type Preference,
  type Route,
  type RoutingConfig,
  type HopPricer,
  type RoutingSignals,
} from "../../../packages/domain/routing.js";
import { newId } from "../../../packages/db/src/ids.js";
import type { VaultClient } from "../../../packages/chains/vault/index.js";
import { ASSET_DECIMALS, InvalidAmountError, toUnits } from "../../../packages/providers/money.js";
import type { Asset, Chain, Country, FiatCurrency, PayoutType, ProviderAdapter, ProviderQuote, QuoteAmount } from "../../../packages/providers/types.js";
import { formatTokenAmount } from "./dashboard.js";
import type { Db, Unit } from "./db.js";
import { ApiError, invalidRequest } from "./errors.js";

export interface QuoteDeps {
  adapters: readonly ProviderAdapter[];
  hop?: HopPricer;
  routing: RoutingConfig;
  signals: RoutingSignals;
  now: () => Date;
  // Present when quotes can read the payer's free vault balance, to say how much they can send.
  vault?: Pick<VaultClient, "getBalance">;
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

export const COUNTRY: Record<QuoteInput["currency"], Country> = { ngn: "NG", kes: "KE", ghs: "GH", idr: "ID", php: "PH" };
const NOT_OFFERED: Partial<Record<Dropped["reason"], "breaker_open" | "timeout" | "error" | "half_open_over_limit">> = {
  breaker_open: "breaker_open",
  timeout: "timeout",
  error: "error",
  half_open_over_limit: "half_open_over_limit",
};

export const MAX_PROVIDER_FEE_CENTS = 25n;
export const providerFeeCap = (asset: Asset) => MAX_PROVIDER_FEE_CENTS * 10n ** BigInt(ASSET_DECIMALS[asset] - 2);

type HopLeg = { amountIn: bigint; amountOut: bigint };

const ceilDiv = (numerator: bigint, denominator: bigint) => (numerator + denominator - 1n) / denominator;

// What the vault pays for an Intents payout at most: the provider may add up to the fee cap to what it asks for once
// its order exists (Paycrest adds its network fee), and the hop charges its own spread on top of that.
export function totalDebit(hop: HopLeg, asset: Asset): bigint {
  return ceilDiv((hop.amountOut + providerFeeCap(asset)) * hop.amountIn, hop.amountOut);
}

// The largest send amount whose total debit still fits what the payer holds, scaling the route's hop linearly.
export function maxSendAmount(sent: bigint, hop: HopLeg, asset: Asset, available: bigint): bigint {
  const feeIn = ceilDiv(providerFeeCap(asset) * hop.amountIn, hop.amountOut);
  if (available <= feeIn) return 0n;
  const debitAt = (amount: bigint) => {
    const amountIn = (amount * hop.amountIn) / sent;
    const amountOut = (amountIn * hop.amountOut) / hop.amountIn;
    return amountOut > 0n ? totalDebit({ amountIn, amountOut }, asset) : feeIn;
  };
  let amount = ((available - feeIn) * sent) / hop.amountIn;
  while (amount > 0n && debitAt(amount) > available) amount -= 1n;
  return amount;
}

// bigint amounts travel as strings so the stored quote survives JSON.
function serializeProviderQuote(quote: ProviderQuote, hop: Route["hop"]): Prisma.InputJsonObject {
  return {
    hop: hop ? { chain: hop.chain, amountIn: hop.amountIn.toString(), amountOut: hop.amountOut.toString(), seconds: hop.seconds } : null,
    provider: quote.provider,
    providerQuoteId: quote.providerQuoteId ?? null,
    sendUnits: quote.sendUnits.toString(),
    receiveMinorUnits: quote.receiveMinorUnits.toString(),
    rate: quote.rate,
    fees: quote.fees.map((fee) => ({ kind: fee.kind, amount: fee.amount.toString(), unit: fee.unit })),
    estimatedSettleSeconds: quote.estimatedSettleSeconds ?? null,
    expiresAt: quote.expiresAt.toISOString(),
  };
}

export function reviveHop(json: unknown): { chain: Chain; amountIn: bigint; amountOut: bigint; seconds: number } | null {
  const hop = (json as { hop?: { chain: Chain; amountIn: string; amountOut: string; seconds: number } | null }).hop;
  return hop ? { chain: hop.chain, amountIn: BigInt(hop.amountIn), amountOut: BigInt(hop.amountOut), seconds: hop.seconds } : null;
}

export function reviveProviderQuote(json: unknown): ProviderQuote {
  const stored = json as ReturnType<typeof serializeProviderQuote> & Record<string, any>;
  return {
    provider: stored.provider,
    ...(stored.providerQuoteId ? { providerQuoteId: stored.providerQuoteId } : {}),
    sendUnits: BigInt(stored.sendUnits),
    receiveMinorUnits: BigInt(stored.receiveMinorUnits),
    rate: stored.rate,
    fees: stored.fees.map((fee: { kind: "provider" | "network"; amount: string; unit: Asset | FiatCurrency }) => ({ ...fee, amount: BigInt(fee.amount) })),
    ...(stored.estimatedSettleSeconds !== null ? { estimatedSettleSeconds: stored.estimatedSettleSeconds } : {}),
    expiresAt: new Date(stored.expiresAt),
  };
}

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
export const rateOf = (minor: bigint, amountIn: bigint) => Number((minor * 10n ** 8n) / amountIn) / 10_000;
const wholeUnits = (minor: bigint) => Number(minor / 100n);
export const total = (route: Route) => route.fees.provider + route.fees.network + route.fees.intents + route.fees.ours;

export async function developerIdFor(tx: Db, userId: string): Promise<string> {
  const workspace = await tx.workspace.findFirst({ where: { ownerId: userId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  return workspace?.id ?? userId;
}

// Pricing calls every provider and can take seconds, so it never runs inside a transaction: a held transaction keeps a
// pool connection, and a few slow quotes at once would leave every other request waiting for one.
export async function priceQuote(deps: QuoteDeps, input: QuoteInput) {
  const amount = parseAmount(input);
  const requested = amount.side === "send" ? amount.units : amount.minorUnits;
  if (requested <= 0n) throw invalidRequest("amount must be greater than zero.");

  const now = deps.now();
  const currency = input.currency.toUpperCase() as FiatCurrency;
  const priced = await quoteRoutes(
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
    deps.hop,
  );
  logTimeouts("quote", input.currency, priced.dropped);
  return { ...priced, now };
}

export type PricedQuote = Awaited<ReturnType<typeof priceQuote>>;

export async function saveQuote(tx: Db, userId: string, input: QuoteInput, priced: PricedQuote, payerAvailable: bigint | null = null) {
  const { routes, dropped, expiresAt, now } = priced;
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
      kind: route.kind,
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
      providerQuote: serializeProviderQuote(route.providerQuote, route.hop),
    })),
  });

  const next = routes[1];
  const asset = input.token.toUpperCase() as Asset;
  const debit = best.kind === "intents" && best.hop ? totalDebit(best.hop, asset) : null;
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
        via_intents: route.kind === "intents",
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
    ...(debit !== null ? { total_debit: debit.toString() } : {}),
    ...(debit !== null && best.hop && payerAvailable !== null ? { max_amount: maxSendAmount(best.amountIn, best.hop, asset, payerAvailable).toString() } : {}),
  };
}

export async function requestQuote(tx: Db, deps: QuoteDeps, userId: string, input: QuoteInput) {
  return saveQuote(tx, userId, input, await priceQuote(deps, input));
}

// Prices first, then opens the transaction only to store the quote.
export async function quoteAndSave(unit: Unit, deps: QuoteDeps, userId: string, input: QuoteInput) {
  const priced = await priceQuote(deps, input);
  const available = priced.routes[0]?.kind === "intents" ? await payerAvailable(unit, deps, userId) : null;
  return unit((tx) => saveQuote(tx, userId, input, priced, available));
}

// The vault contract, not the ledger mirror, says what the payer can spend. A read that fails leaves max_amount out.
async function payerAvailable(unit: Unit, deps: QuoteDeps, userId: string): Promise<bigint | null> {
  if (!deps.vault) return null;
  const payer = (await unit((tx) => tx.user.findUnique({ where: { id: userId }, select: { nearAccount: true } })))?.nearAccount;
  if (!payer) return null;
  return deps.vault.getBalance(payer).then((balance) => balance.available, () => null);
}

export function logTimeouts(operation: string, currency: string, dropped: readonly Dropped[]): void {
  const slow = dropped.filter((drop) => drop.reason === "timeout").map((drop) => drop.provider);
  if (slow.length > 0) console.warn(`[routing] ${operation} ${currency}: no answer in time from ${slow.join(", ")}`);
}
