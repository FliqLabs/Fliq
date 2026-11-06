import { randomBytes } from "node:crypto";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { MockVault } from "../packages/chains/vault/index.js";
import { DEFAULT_ROUTING_CONFIG, NO_SIGNALS } from "../packages/domain/routing.js";
import type { ProviderAdapter } from "../packages/providers/types.js";
import { MockProvisioner } from "../apps/api/src/accounts.js";
import { buildApp } from "../apps/api/src/app.js";
import type { EmailSender } from "../apps/api/src/auth/email-links.js";
import { loadConfig, type Config } from "../apps/api/src/config.js";
import { createDatabase, unitOf, type Database } from "../apps/api/src/db.js";
import { createHandlers } from "../apps/api/src/handlers.js";
import { DEFAULT_VELOCITY } from "../apps/api/src/payouts.js";
import { sandboxAdapters } from "../apps/api/src/sandbox.js";

// Throwaway local database only; Prisma loads .env, which may point at a shared one.
export const databaseEnabled =
  /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") &&
  Boolean(process.env.FLIQ_ACCESS_SECRET);

export const NOW = new Date("2026-11-05T10:00:00Z");

type Method = "GET" | "POST" | "PATCH" | "DELETE";

export interface Developer {
  userId: string;
  workspaceId: string;
  access: string;
  sandboxKey: string;
}

export interface Harness {
  app: FastifyInstance;
  database: Database;
  config: Config;
  adapters: ProviderAdapter[];
  call(
    method: Method,
    url: string,
    options?: { payload?: object; token?: string; headers?: Record<string, string> },
  ): Promise<LightMyRequestResponse>;
  signUp(label: string): Promise<Developer>;
  cleanUp(): Promise<void>;
}

export function createHarness(overrides: { config?: Partial<Config>; now?: () => Date } = {}): Harness {
  const database = createDatabase();
  const config = { ...loadConfig(), ...overrides.config };
  const now = overrides.now ?? (() => NOW);
  const adapters = sandboxAdapters(now);
  const links: string[] = [];
  const email: EmailSender = { sendSignInLink: async (_to, link) => void links.push(link) };
  const unit = unitOf(database);
  const app = buildApp({
    config,
    unit,
    handlers: createHandlers({
      config,
      unit,
      email,
      provisioner: new MockProvisioner(config.vaultAccount),
      vault: new MockVault({ registrar: "registrar.test.near", usdc: "usdc.test.near", now: () => 0n }),
      quotes: { adapters, routing: DEFAULT_ROUTING_CONFIG, signals: NO_SIGNALS, now },
      payouts: { config, adapters, velocity: DEFAULT_VELOCITY, now },
      now,
    }),
  });
  const emails: string[] = [];

  const call: Harness["call"] = (method, url, options = {}) =>
    app.inject({
      method,
      url: `/v1${url}`,
      ...(options.payload ? { payload: options.payload } : {}),
      headers: { ...(options.token ? { authorization: `Bearer ${options.token}` } : {}), ...options.headers },
    });

  async function signUp(label: string): Promise<Developer> {
    await app.ready();
    const address = `${label}+${randomBytes(4).toString("hex")}@example.test`;
    emails.push(address);
    await call("POST", "/auth/email-links", { payload: { email: address } });
    const token = new URL(links.at(-1) as string).searchParams.get("token") as string;
    const session = (await call("POST", "/auth/email-links/verify", { payload: { token } })).json();
    const created = await call("POST", "/workspaces", {
      payload: { name: `${label} Labs`, use_case: "wallet", countries: ["ng", "ke"] },
      token: session.access_token,
      headers: { "idempotency-key": `ws-${randomBytes(6).toString("hex")}` },
    });
    const body = created.json();
    return {
      userId: session.user.user_id,
      workspaceId: body.workspace.workspace_id,
      access: session.access_token,
      sandboxKey: body.sandbox_key.key,
    };
  }

  async function cleanUp() {
    const users = await database.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
    const userIds = users.map((user) => user.id);
    const workspaceIds = (
      await database.workspace.findMany({ where: { ownerId: { in: userIds } }, select: { id: true } })
    ).map((w) => w.id);
    const developers = [...workspaceIds, ...userIds];
    await database.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.$executeRaw`DELETE FROM developer.audit_events WHERE workspace_id = ANY(${workspaceIds}::text[])`;
      await tx.$executeRaw`DELETE FROM ledger.journal_lines WHERE entry_id IN (SELECT e.id FROM ledger.journal_entries e JOIN core.payouts p ON p.id = e.payout_id WHERE p.developer_id = ANY(${developers}::text[]))`;
      await tx.$executeRaw`DELETE FROM ledger.journal_entries WHERE payout_id IN (SELECT id FROM core.payouts WHERE developer_id = ANY(${developers}::text[]))`;
      await tx.$executeRaw`DELETE FROM core.payout_events WHERE payout_id IN (SELECT id FROM core.payouts WHERE developer_id = ANY(${developers}::text[]))`;
      await tx.$executeRaw`DELETE FROM core.payouts WHERE developer_id = ANY(${developers}::text[])`;
      await tx.$executeRaw`DELETE FROM core.quote_routes WHERE quote_id IN (SELECT id FROM core.quotes WHERE developer_id = ANY(${developers}::text[]))`;
      await tx.$executeRaw`DELETE FROM core.quotes WHERE developer_id = ANY(${developers}::text[])`;
      await tx.$executeRaw`DELETE FROM core.recipients WHERE user_id = ANY(${userIds}::text[])`;
      await tx.$executeRaw`DELETE FROM developer.api_keys WHERE workspace_id = ANY(${workspaceIds}::text[])`;
      await tx.$executeRaw`DELETE FROM developer.workspaces WHERE id = ANY(${workspaceIds}::text[])`;
      await tx.$executeRaw`DELETE FROM developer.idempotency_records WHERE scope = ANY(${userIds}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.sessions WHERE user_id = ANY(${userIds}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.users WHERE id = ANY(${userIds}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.email_links WHERE email = ANY(${emails}::text[])`;
    });
    await database.$disconnect();
    await app.close();
  }

  return { app, database, config, adapters, call, signUp, cleanUp };
}
