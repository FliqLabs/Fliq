import type { Prisma } from "@prisma/client";
import { decrypt } from "../../../packages/db/src/crypto.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { invalidRequest, notFound } from "./errors.js";
import { institutionName } from "./institutions.js";

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
  return {
    items: keys.map((key) => ({
      key_id: key.id,
      environment: key.environment,
      masked: `${key.prefix}...${key.last4}`,
      created_at: key.createdAt.toISOString(),
    })),
  };
}

export async function onboardingProgress(db: Db, workspaceId: string) {
  const payouts = await db.payout.count({ where: { developerId: workspaceId } });
  return {
    steps: [
      { id: "create_test_payout", done: payouts > 0 },
      { id: "add_webhook", done: false },
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

export async function listPayouts(db: Db, config: Config, workspaceId: string, limit: number, cursor: string | undefined) {
  const after = cursor ? decodeCursor(cursor) : undefined;
  const rows = await db.payout.findMany({
    where: {
      developerId: workspaceId,
      ...(after && {
        OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }],
      }),
    },
    include: { recipient: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
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
    })),
    next_cursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export function parseLimit(raw: unknown): number {
  if (raw === undefined) return 25;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalidRequest("limit must be a whole number from 1 to 100.");
  return limit;
}
