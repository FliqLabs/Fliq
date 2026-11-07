import type { Prisma } from "@prisma/client";
import { decrypt } from "../../../packages/db/src/crypto.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { invalidRequest, notFound } from "./errors.js";
import { institutionName } from "./institutions.js";
import { keyView } from "./keys.js";
import { historyFields, historyInclude, payoutWhere, type PayoutFilter } from "./payout-history.js";

type WorkspaceRow = Prisma.WorkspaceGetPayload<object>;

export const workspaceView = (workspace: WorkspaceRow) => ({
  workspace_id: workspace.id,
  name: workspace.name,
  use_case: workspace.useCase,
  countries: workspace.countries,
  live_enabled: false,
});

export async function currentWorkspace(db: Db, userId: string): Promise<WorkspaceRow> {
  const workspace = await db.workspace.findFirst({ where: { ownerId: userId }, orderBy: { createdAt: "desc" } });
  if (!workspace) throw notFound("Create a workspace first.");
  return workspace;
}

export async function listKeys(db: Db, workspaceId: string) {
  const keys = await db.apiKey.findMany({ where: { workspaceId, revokedAt: null }, orderBy: { createdAt: "desc" } });
  return { items: keys.map(keyView) };
}

export async function onboardingProgress(db: Db, workspaceId: string) {
  const payouts = await db.payout.count({ where: { developerId: workspaceId } });
  const endpoints = await db.webhookEndpoint.count({ where: { workspaceId, deletedAt: null } });
  return {
    steps: [
      { id: "create_test_payout", done: payouts > 0 },
      { id: "add_webhook", done: endpoints > 0 },
      { id: "go_live", done: false },
    ],
  };
}

const TOKEN_DECIMALS = 6n;

export function formatTokenAmount(baseUnits: bigint): string {
  const scale = 10n ** TOKEN_DECIMALS;
  const fraction = (baseUnits % scale).toString().padStart(Number(TOKEN_DECIMALS), "0").replace(/0+$/, "").padEnd(2, "0");
  return `${baseUnits / scale}.${fraction}`;
}

const encodeCursor = (createdAt: Date, id: string) => Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const createdAt = new Date(iso ?? "");
  if (!id || Number.isNaN(createdAt.getTime())) throw invalidRequest("Invalid cursor.");
  return { createdAt, id };
}

type PayoutWithRecipient = Prisma.PayoutGetPayload<{ include: { recipient: true } }>;

// The masked view: the list, the CSV export and outbound webhooks never carry a full account number.
export const payoutSummary = (row: PayoutWithRecipient, config: Config) => ({
  payout_id: row.id,
  state: row.state,
  account_name: decrypt(row.recipient.nameCipher, config.dataKey),
  bank: { code: row.recipient.institutionCode, name: institutionName(row.recipient.institutionCode) },
  account_last4: decrypt(row.recipient.accountCipher, config.dataKey).slice(-4),
  amount: formatTokenAmount(row.amountIn),
  receive: Number(row.amountOutMinor / 100n),
  currency: row.currency,
  provider: row.provider,
  created_at: row.createdAt.toISOString(),
});

const NO_FILTER: PayoutFilter = { statuses: [] };

export async function listPayouts(db: Db, config: Config, workspaceId: string, limit: number, cursor: string | undefined, filter: PayoutFilter = NO_FILTER) {
  const after = cursor ? decodeCursor(cursor) : undefined;
  const rows = await db.payout.findMany({
    where: {
      AND: [
        payoutWhere(workspaceId, filter),
        ...(after ? [{ OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] }] : []),
      ],
    },
    include: historyInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({ ...payoutSummary(row, config), ...historyFields(row) })),
    next_cursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export function parseLimit(raw: unknown): number {
  if (raw === undefined) return 25;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalidRequest("limit must be a whole number from 1 to 100.");
  return limit;
}

export function parseTimezone(raw: unknown): string {
  if (raw === undefined) return "UTC";
  const valid =
    typeof raw === "string" &&
    (() => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: raw });
        return true;
      } catch {
        return false;
      }
    })();
  if (!valid) throw invalidRequest("tz must be an IANA time zone such as Africa/Lagos.");
  return raw as string;
}

interface CurrencyTotal {
  currency: string;
  amount: number;
}

const totals = (rows: { currency: string; amount: bigint }[]): CurrencyTotal[] =>
  rows.map((row) => ({ currency: row.currency, amount: Number(row.amount) }));

// Timestamps are stored in UTC. "Today" is the caller's calendar day in their own timezone, turned into a UTC range.
export async function payoutStats(db: Db, workspaceId: string, timezone: string, now: Date) {
  const known = await db.$queryRaw<unknown[]>`SELECT 1 FROM pg_timezone_names WHERE name = ${timezone}`;
  if (known.length === 0) throw invalidRequest("tz is not a time zone this server knows.");

  const [day] = await db.$queryRaw<{ start_at: Date; end_at: Date }[]>`
    SELECT
      date_trunc('day', ${now}::timestamptz AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone} AS start_at,
      (date_trunc('day', ${now}::timestamptz AT TIME ZONE ${timezone}) + interval '1 day') AT TIME ZONE ${timezone} AS end_at`;
  const { start_at: start, end_at: end } = day as NonNullable<typeof day>;

  const settled = await db.$queryRaw<{ currency: string; amount: bigint; count: bigint }[]>`
    SELECT currency, floor(sum(local_amount))::bigint AS amount, count(*)::bigint AS count
    FROM analytics.payouts
    WHERE workspace_id = ${workspaceId} AND settled_at >= ${start} AND settled_at < ${end}
    GROUP BY currency ORDER BY currency`;
  const [median] = await db.$queryRaw<{ seconds: number | null }[]>`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds_to_bank)::float8 AS seconds
    FROM analytics.payouts
    WHERE workspace_id = ${workspaceId} AND settled_at >= ${start} AND settled_at < ${end}`;
  const refused = await db.$queryRaw<{ currency: string; amount: bigint; count: bigint }[]>`
    SELECT currency, floor(sum(local_amount))::bigint AS amount, count(*)::bigint AS count
    FROM analytics.payouts
    WHERE workspace_id = ${workspaceId} AND is_refusal AND created_at >= ${start} AND created_at < ${end}
    GROUP BY currency ORDER BY currency`;

  const count = (rows: { count: bigint }[]) => rows.reduce((sum, row) => sum + Number(row.count), 0);
  return {
    timezone,
    window: { start: start.toISOString(), end: end.toISOString() },
    settled: { count: count(settled), totals: totals(settled) },
    median_seconds_to_bank: median?.seconds ?? null,
    refused: { count: count(refused), totals: totals(refused) },
  };
}
