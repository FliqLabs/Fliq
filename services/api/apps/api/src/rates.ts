import { quoteRoutes } from "../../../packages/domain/routing.js";
import type { Asset, Chain, FiatCurrency, PayoutType } from "../../../packages/providers/types.js";
import { ApiError, invalidRequest } from "./errors.js";
import { COUNTRY, logTimeouts, rateOf, total, type QuoteDeps, type QuoteInput } from "./quotes.js";

export const RATE_TTL_MS = 10_000;
// A public rate answers fast or says no route: past this, nobody is waiting for it.
export const RATE_DEADLINE_MS = 8_000;
// Fees are partly flat, so a rate only means something for a stated size. 100 tokens in 6-decimal units.
const REFERENCE_UNITS = 100_000_000n;
const TOKENS: readonly string[] = ["usdc", "usdt"];

// The payout a public rate is for: Ghana's providers pay mobile money, everywhere else is priced for a bank account.
export function referencePayoutType(currency: QuoteInput["currency"]): PayoutType {
  return currency === "ghs" ? "mobile_money" : "bank";
}

export interface Rate {
  token: QuoteInput["token"];
  currency: QuoteInput["currency"];
  rate: number;
  rate_before_fees: number;
  provider: string;
  providers_quoting: number;
  spread: number;
  fetched_at: string;
}

type Entry = { value: Promise<Rate>; expiresAt: number };

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

function deadline(ms: number): Promise<null> {
  return new Promise((resolve) => setTimeout(() => resolve(null), ms).unref?.());
}

export function createRates(deps: QuoteDeps) {
  const cache = new Map<string, Entry>();

  async function fetchRate(token: Rate["token"], currency: Rate["currency"], deadlineMs: number): Promise<Rate> {
    const now = deps.now();
    const priced = quoteRoutes(
      deps.adapters,
      {
        corridor: { country: COUNTRY[currency], currency: currency.toUpperCase() as FiatCurrency, payoutType: referencePayoutType(currency) },
        source: { asset: token.toUpperCase() as Asset, chain: "near" as Chain },
        amount: { side: "send", units: REFERENCE_UNITS },
        preference: "best_rate",
      },
      deps.routing,
      deps.signals,
      now,
      deps.hop,
    );
    const answer = await Promise.race([priced, deadline(deadlineMs)]);
    if (!answer) {
      console.warn(`[routing] rate ${currency}: no answer within ${deadlineMs}ms`);
      throw new ApiError(422, "no_route", "No provider can pay this corridor right now.");
    }
    logTimeouts("rate", currency, answer.dropped);
    const { routes, expiresAt } = answer;
    const best = routes[0];
    if (!best || expiresAt <= now) throw new ApiError(422, "no_route", "No provider can pay this corridor right now.");
    const rate = rateOf(best.amountOutMinor, best.amountIn);
    const beforeFees = rateOf(best.amountOutMinor + total(best), best.amountIn);
    return {
      token,
      currency,
      rate,
      rate_before_fees: beforeFees,
      provider: best.provider,
      providers_quoting: routes.length,
      spread: round4(beforeFees - rate),
      fetched_at: now.toISOString(),
    };
  }

  return function getRate(token: string, currency: string, deadlineMs = RATE_DEADLINE_MS): Promise<Rate> {
    if (!TOKENS.includes(token)) throw invalidRequest(`Unsupported token ${token}.`);
    if (!Object.hasOwn(COUNTRY, currency)) throw invalidRequest(`Unsupported currency ${currency}.`);
    const key = `${token}:${currency}`;
    const nowMs = deps.now().getTime();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > nowMs) return cached.value;
    const value = fetchRate(token as Rate["token"], currency as Rate["currency"], deadlineMs);
    cache.set(key, { value, expiresAt: nowMs + RATE_TTL_MS });
    value.catch(() => {
      if (cache.get(key)?.value === value) cache.delete(key);
    });
    return value;
  };
}
