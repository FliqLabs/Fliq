import { sha256Hex } from "../../../packages/db/src/crypto.js";
import type { Db, Unit } from "./db.js";
import { invalidRequest } from "./errors.js";
import { keyView } from "./keys.js";
import { POLICIES } from "./rate-limit.js";

export type UsageOutcome = "succeeded" | "failed" | "rate_limited";

export interface UsageEvent {
  keyId: string;
  outcome: UsageOutcome;
  payoutCreated: boolean;
  at: Date;
}

const MAX_DAYS = 90;
const DAY_MS = 86_400_000;

const utcDay = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

// One upsert per finished key request. The key's workspace is read in the same statement, so a request never
// counts against a workspace it does not belong to.
export async function recordUsage(tx: Db, event: UsageEvent): Promise<void> {
  const day = utcDay(event.at);
  const succeeded = event.outcome === "succeeded" ? 1 : 0;
  const failed = event.outcome === "failed" ? 1 : 0;
  const limited = event.outcome === "rate_limited" ? 1 : 0;
  const payouts = event.payoutCreated ? 1 : 0;
  await tx.$executeRaw`
    INSERT INTO developer.api_usage_daily (key_id, day, workspace_id, requests, succeeded, failed, rate_limited, payouts_created)
    SELECT k.id, ${day}::date, k.workspace_id, 1, ${succeeded}, ${failed}, ${limited}, ${payouts}
    FROM developer.api_keys k WHERE k.id = ${event.keyId}
    ON CONFLICT (key_id, day) DO UPDATE SET
      requests = api_usage_daily.requests + 1,
      succeeded = api_usage_daily.succeeded + EXCLUDED.succeeded,
      failed = api_usage_daily.failed + EXCLUDED.failed,
      rate_limited = api_usage_daily.rate_limited + EXCLUDED.rate_limited,
      payouts_created = api_usage_daily.payouts_created + EXCLUDED.payouts_created`;
}

// A rate-limited request is refused before authentication, so its key is found by hash here. Unknown keys count nowhere.
export async function keyIdForToken(tx: Db, token: string): Promise<string | null> {
  const key = await tx.apiKey.findUnique({ where: { keyHash: sha256Hex(token) }, select: { id: true } });
  return key?.id ?? null;
}

export function usageRecorder(unit: Unit, log: (message: string) => void) {
  return (event: Omit<UsageEvent, "keyId"> & { keyId?: string; token?: string }): Promise<void> =>
    unit(async (tx) => {
      const keyId = event.keyId ?? (event.token ? await keyIdForToken(tx, event.token) : null);
      if (keyId) await recordUsage(tx, { ...event, keyId });
    }).catch((error: Error) => log(`usage not recorded: ${error.name}`));
}

export function parseDays(raw: string | undefined): number {
  if (raw === undefined) return 7;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    throw invalidRequest(`days must be a whole number from 1 to ${MAX_DAYS}.`);
  }
  return days;
}

interface Counters {
  requests: number;
  succeeded: number;
  failed: number;
  rate_limited: number;
  payouts_created: number;
}

const zero = (): Counters => ({ requests: 0, succeeded: 0, failed: 0, rate_limited: 0, payouts_created: 0 });

function add(
  into: Counters,
  row: { requests: number; succeeded: number; failed: number; rateLimited: number; payoutsCreated: number },
) {
  into.requests += row.requests;
  into.succeeded += row.succeeded;
  into.failed += row.failed;
  into.rate_limited += row.rateLimited;
  into.payouts_created += row.payoutsCreated;
}

// The last `days` UTC days including today, every day present even when it had no traffic.
export async function usageReport(tx: Db, workspaceId: string, days: number, now: Date) {
  const to = utcDay(now);
  const from = new Date(to.getTime() - (days - 1) * DAY_MS);
  const rows = await tx.apiUsageDaily.findMany({ where: { workspaceId, day: { gte: from, lte: to } } });
  const keys = await tx.apiKey.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" } });

  const totals = zero();
  const daily = new Map<string, Counters>();
  for (let index = 0; index < days; index++) {
    daily.set(new Date(from.getTime() + index * DAY_MS).toISOString().slice(0, 10), zero());
  }
  const perKey = new Map<string, Counters>();
  for (const row of rows) {
    add(totals, row);
    add(daily.get(row.day.toISOString().slice(0, 10)) as Counters, row);
    const counters = perKey.get(row.keyId) ?? zero();
    add(counters, row);
    perKey.set(row.keyId, counters);
  }
  return {
    period: {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      days,
      timezone: "UTC",
    },
    totals,
    daily: [...daily.entries()].map(([date, counters]) => ({ date, ...counters })),
    // Revoked keys stay listed while they have usage in the period.
    keys: keys
      .filter((key) => !key.revokedAt || perKey.has(key.id))
      .map((key) => ({ ...keyView(key), ...(perKey.get(key.id) ?? zero()) })),
    rate_limit: { requests_per_minute: POLICIES.apiKey.capacity, scope: "per key" },
  };
}
