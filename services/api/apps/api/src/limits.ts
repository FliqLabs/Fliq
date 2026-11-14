import { createHash } from "node:crypto";
import { newId } from "../../../packages/db/src/ids.js";
import type { Db } from "./db.js";
import { formatUnits, parseUnits } from "./deposits.js";
import { ApiError, invalidRequest } from "./errors.js";
import { developerIdFor } from "./quotes.js";

// A user's own daily limit on what may leave their account: cash-outs, sends to fliq users and sends to outside
// wallets. Lowering it is immediate. Raising or removing it waits RAISE_DELAY_MS and warns the user, so someone holding
// an unlocked phone cannot lift the limit and empty the account in one sitting.
export const RAISE_DELAY_MS = 24 * 60 * 60_000;
const WINDOW_MS = 24 * 60 * 60_000;
const DECIMALS = 6;
const MAX_LIMIT_UNITS = 1_000_000_000n * 10n ** BigInt(DECIMALS);
// A payout in one of these states moved nothing, or brought it back, so it does not count as spent.
const UNSPENT_STATES = ["failed", "expired", "refunded"] as const;

export type LimitsView = {
  daily_limit: string | null;
  spent_today: string;
  remaining: string | null;
  pending: { daily_limit: string | null; effective_at: string } | null;
};

type Stored = { dailyLimitUnits: bigint | null; pendingDailyLimitUnits: bigint | null; pendingDailyLimitAt: Date | null };

const SELECT = { dailyLimitUnits: true, pendingDailyLimitUnits: true, pendingDailyLimitAt: true } as const;
const dollars = (units: bigint) => formatUnits(units, DECIMALS);

export const lockSpending = (tx: Db, userId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`spend:${userId}`}, 0))`;

// A raise whose wait is over becomes the limit the first time anything reads it.
async function stored(tx: Db, userId: string, now: Date): Promise<Stored> {
  const row = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: SELECT });
  if (!row.pendingDailyLimitAt || row.pendingDailyLimitAt > now) return row;
  const matured = { dailyLimitUnits: row.pendingDailyLimitUnits, pendingDailyLimitUnits: null, pendingDailyLimitAt: null };
  await tx.user.update({ where: { id: userId }, data: matured });
  return matured;
}

async function spentToday(tx: Db, userId: string, now: Date): Promise<bigint> {
  const since = new Date(now.getTime() - WINDOW_MS);
  const [payouts, holds] = await Promise.all([
    tx.payout.aggregate({
      where: { developerId: await developerIdFor(tx, userId), createdAt: { gt: since }, state: { notIn: [...UNSPENT_STATES] } },
      _sum: { amountIn: true },
    }),
    tx.spendHold.aggregate({ where: { userId, released: false, createdAt: { gt: since } }, _sum: { units: true } }),
  ]);
  return (payouts._sum.amountIn ?? 0n) + (holds._sum.units ?? 0n);
}

function view(row: Stored, spent: bigint): LimitsView {
  const limit = row.dailyLimitUnits;
  return {
    daily_limit: limit === null ? null : dollars(limit),
    spent_today: dollars(spent),
    remaining: limit === null ? null : dollars(limit > spent ? limit - spent : 0n),
    pending: row.pendingDailyLimitAt
      ? {
          daily_limit: row.pendingDailyLimitUnits === null ? null : dollars(row.pendingDailyLimitUnits),
          effective_at: row.pendingDailyLimitAt.toISOString(),
        }
      : null,
  };
}

export async function limitsOf(tx: Db, userId: string, now: Date): Promise<LimitsView> {
  return view(await stored(tx, userId, now), await spentToday(tx, userId, now));
}

function parseLimit(input: unknown): bigint | null {
  if (input === null) return null;
  const units = typeof input === "string" && /^\d+(\.\d{1,2})?$/.test(input.trim()) ? parseUnits(input, DECIMALS) : null;
  if (units === null || units > MAX_LIMIT_UNITS) throw invalidRequest("daily_limit must be a dollar amount such as \"500\" or \"500.00\", or null for no limit.");
  return units;
}

const isRaise = (current: bigint | null, wanted: bigint | null) => current !== null && (wanted === null || wanted > current);

// Setting the limit it already has cancels a pending raise. A lower limit, or a first limit, also clears one: asking
// for less is never held up by an earlier request for more.
export async function setDailyLimit(tx: Db, userId: string, input: unknown, now: Date): Promise<LimitsView> {
  const wanted = parseLimit(input);
  await lockSpending(tx, userId);
  const row = await stored(tx, userId, now);
  await tx.limitChange.updateMany({ where: { userId, cancelledAt: null, effectiveAt: { gt: now } }, data: { cancelledAt: now } });
  if (isRaise(row.dailyLimitUnits, wanted)) {
    const effectiveAt = new Date(now.getTime() + RAISE_DELAY_MS);
    await tx.user.update({ where: { id: userId }, data: { pendingDailyLimitUnits: wanted, pendingDailyLimitAt: effectiveAt } });
    await tx.limitChange.create({ data: { id: newId("lim"), userId, toUnits: wanted, effectiveAt, createdAt: now } });
  } else {
    await tx.user.update({ where: { id: userId }, data: { dailyLimitUnits: wanted, pendingDailyLimitUnits: null, pendingDailyLimitAt: null } });
  }
  return limitsOf(tx, userId, now);
}

export async function cancelPendingLimit(tx: Db, userId: string, now: Date): Promise<LimitsView> {
  await lockSpending(tx, userId);
  await stored(tx, userId, now);
  await tx.user.update({ where: { id: userId }, data: { pendingDailyLimitUnits: null, pendingDailyLimitAt: null } });
  await tx.limitChange.updateMany({ where: { userId, cancelledAt: null, effectiveAt: { gt: now } }, data: { cancelledAt: now } });
  return limitsOf(tx, userId, now);
}

// The caller holds lockSpending, so the read and whatever it then records cannot interleave with another spend.
export async function assertWithinDailyLimit(tx: Db, userId: string, units: bigint, now: Date): Promise<void> {
  const { dailyLimitUnits: limit } = await stored(tx, userId, now);
  if (limit === null) return;
  const spent = await spentToday(tx, userId, now);
  if (spent + units <= limit) return;
  const left = limit > spent ? limit - spent : 0n;
  throw new ApiError(
    422,
    "daily_limit",
    `This is over the daily limit you set ($${dollars(limit)}). You have $${dollars(left)} left for the next 24 hours. You can change your limit in Settings.`,
  );
}

export const spendRef = (signedDelegate: string) => createHash("sha256").update(signedDelegate).digest("hex");

// Holds a relayed send against the limit before it goes out. The same delegate relayed again holds nothing new.
export async function holdSpend(tx: Db, userId: string, ref: string, units: bigint, now: Date): Promise<void> {
  await lockSpending(tx, userId);
  const existing = await tx.spendHold.findUnique({ where: { ref }, select: { released: true } });
  if (existing && !existing.released) return;
  await assertWithinDailyLimit(tx, userId, units, now);
  if (existing) await tx.spendHold.update({ where: { ref }, data: { released: false, createdAt: now } });
  else await tx.spendHold.create({ data: { id: newId("hold"), userId, ref, units, createdAt: now } });
}

export async function releaseSpend(tx: Db, ref: string): Promise<void> {
  await tx.spendHold.updateMany({ where: { ref }, data: { released: true } });
}
