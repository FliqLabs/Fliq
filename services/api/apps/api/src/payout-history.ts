import type { Prisma } from "@prisma/client";
import type { PayoutState } from "../../../packages/domain/payout-state.js";
import type { Config } from "./config.js";
import { payoutSummary } from "./dashboard.js";
import type { Db } from "./db.js";
import { invalidRequest } from "./errors.js";

// What the dashboard shows. An unknown provider outcome (provider_timeout, awaiting_recon) stays pending:
// it is being re-queried and must never read as failed.
export const DISPLAY_STATUSES = [
  "pending",
  "paying_out",
  "settled",
  "refused",
  "refunding",
  "refunded",
  "failed",
  "expired",
] as const;
export type DisplayStatus = (typeof DISPLAY_STATUSES)[number];

const PENDING_STATES: PayoutState[] = [
  "created",
  "provider_timeout",
  "awaiting_recon",
  "awaiting_deposit",
  "deposit_seen",
  "routing",
  "with_provider",
];
// Failure reasons starting with vault_ are refusals by the vault caps (see core.payouts.failure_reason).
const VAULT_REFUSAL = "vault_";

export function displayStatus(row: {
  state: PayoutState | string;
  failureReason: string | null;
}): DisplayStatus {
  const state = row.state as PayoutState;
  if (PENDING_STATES.includes(state)) return "pending";
  if (state === "failed") return row.failureReason?.startsWith(VAULT_REFUSAL) ? "refused" : "failed";
  return state as DisplayStatus;
}

function statusWhere(status: DisplayStatus): Prisma.PayoutWhereInput {
  switch (status) {
    case "pending":
      return { state: { in: PENDING_STATES } };
    case "refused":
      return { state: "failed", failureReason: { startsWith: VAULT_REFUSAL } };
    case "failed":
      return {
        state: "failed",
        OR: [{ failureReason: null }, { NOT: { failureReason: { startsWith: VAULT_REFUSAL } } }],
      };
    default:
      return { state: status };
  }
}

export interface PayoutQuery {
  limit?: string;
  cursor?: string;
  status?: string;
  provider?: string;
  currency?: string;
  from?: string;
  to?: string;
  q?: string;
}

export interface PayoutFilter {
  statuses: DisplayStatus[];
  provider?: string;
  currency?: string;
  from?: Date;
  to?: Date;
  q?: string;
}

const MAX_SEARCH_LENGTH = 100;

function parseDate(raw: string | undefined, name: string): Date | undefined {
  if (raw === undefined) return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw invalidRequest(`${name} must be an ISO 8601 date-time.`);
  return date;
}

export function parsePayoutFilter(query: PayoutQuery): PayoutFilter {
  const statuses = (query.status ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const unknown = statuses.filter((value) => !DISPLAY_STATUSES.includes(value as DisplayStatus));
  if (unknown.length > 0) throw invalidRequest(`status must be a list of ${DISPLAY_STATUSES.join(", ")}.`);
  const q = query.q?.trim();
  if (q && q.length > MAX_SEARCH_LENGTH)
    throw invalidRequest(`q must be at most ${MAX_SEARCH_LENGTH} characters.`);
  const from = parseDate(query.from, "from");
  const to = parseDate(query.to, "to");
  if (from && to && from >= to) throw invalidRequest("from must be before to.");
  return {
    statuses: statuses as DisplayStatus[],
    ...(query.provider ? { provider: query.provider } : {}),
    ...(query.currency ? { currency: query.currency.toLowerCase() } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(q ? { q } : {}),
  };
}

// Search matches a payout id or the developer's own reference exactly. Recipient names are encrypted at
// rest, so they cannot be searched in the database.
export function payoutWhere(workspaceId: string, filter: PayoutFilter): Prisma.PayoutWhereInput {
  const and: Prisma.PayoutWhereInput[] = [{ developerId: workspaceId }];
  if (filter.statuses.length > 0) and.push({ OR: filter.statuses.map(statusWhere) });
  if (filter.provider) and.push({ provider: filter.provider });
  if (filter.currency) and.push({ currency: filter.currency });
  if (filter.from) and.push({ createdAt: { gte: filter.from } });
  if (filter.to) and.push({ createdAt: { lt: filter.to } });
  if (filter.q) and.push({ OR: [{ id: filter.q }, { clientReference: filter.q }] });
  return { AND: and };
}

type HistoryRow = Prisma.PayoutGetPayload<{ include: { recipient: true; events: true } }>;

export const historyInclude = {
  recipient: true,
  events: {
    where: { toState: { in: ["settled", "deposit_seen"] as PayoutState[] } },
    orderBy: { version: "asc" as const },
  },
} satisfies Prisma.PayoutInclude;

// Settlement time is measured from the deposit being seen to the settled event, as on the receipt.
export function historyFields(row: HistoryRow) {
  const at = (state: string) => row.events.find((event) => event.toState === state)?.createdAt;
  const settledAt = at("settled");
  const depositAt = at("deposit_seen");
  return {
    status: displayStatus(row),
    client_reference: row.clientReference,
    updated_at: row.updatedAt.toISOString(),
    settled_at: settledAt?.toISOString() ?? null,
    seconds_to_bank:
      settledAt && depositAt ? Math.round((settledAt.getTime() - depositAt.getTime()) / 1000) : null,
    failure_reason: row.failureReason,
  };
}

export const MAX_EXPORT_ROWS = 5_000;

const CSV_COLUMNS = [
  "payout_id",
  "client_reference",
  "status",
  "state",
  "created_at",
  "updated_at",
  "settled_at",
  "seconds_to_bank",
  "amount",
  "receive",
  "currency",
  "provider",
  "bank_code",
  "bank_name",
  "account_last4",
  "failure_reason",
] as const;

// A cell starting with one of these is run as a formula by spreadsheet apps, so it is prefixed with a quote.
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Bounded instead of streamed: the newest MAX_EXPORT_ROWS rows, with a header saying when it was cut.
// No account names or full account numbers, only the bank and last four digits.
export async function exportPayoutsCsv(tx: Db, config: Config, workspaceId: string, filter: PayoutFilter) {
  const rows = await tx.payout.findMany({
    where: payoutWhere(workspaceId, filter),
    include: historyInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_EXPORT_ROWS + 1,
  });
  const truncated = rows.length > MAX_EXPORT_ROWS;
  const lines = rows.slice(0, MAX_EXPORT_ROWS).map((row) => {
    const summary = payoutSummary(row, config);
    const history = historyFields(row);
    const record: Record<(typeof CSV_COLUMNS)[number], unknown> = {
      payout_id: summary.payout_id,
      client_reference: history.client_reference,
      status: history.status,
      state: summary.state,
      created_at: summary.created_at,
      updated_at: history.updated_at,
      settled_at: history.settled_at,
      seconds_to_bank: history.seconds_to_bank,
      amount: summary.amount,
      receive: summary.receive,
      currency: summary.currency,
      provider: summary.provider,
      bank_code: summary.bank.code,
      bank_name: summary.bank.name,
      account_last4: summary.account_last4,
      failure_reason: history.failure_reason,
    };
    return CSV_COLUMNS.map((column) => csvCell(record[column])).join(",");
  });
  return { csv: [CSV_COLUMNS.join(","), ...lines].join("\r\n") + "\r\n", rows: lines.length, truncated };
}
