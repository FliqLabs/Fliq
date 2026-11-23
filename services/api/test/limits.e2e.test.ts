import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockVault } from "../packages/chains/vault/index.js";
import { MockProvisioner } from "../apps/api/src/accounts.js";
import { buildApp } from "../apps/api/src/app.js";
import type { EmailSender } from "../apps/api/src/auth/email-links.js";
import { loadConfig } from "../apps/api/src/config.js";
import { createDatabase, unitOf } from "../apps/api/src/db.js";
import { createHandlers } from "../apps/api/src/handlers.js";
import { holdSpend, releaseSpend } from "../apps/api/src/limits.js";
import { DEFAULT_VELOCITY } from "../apps/api/src/payouts.js";
import { limitChangeMessage } from "../apps/api/src/push.js";
import { sandboxAdapters } from "../apps/api/src/sandbox.js";
import { DEFAULT_ROUTING_CONFIG, NO_SIGNALS } from "../packages/domain/routing.js";
import type { ProviderAdapter } from "../packages/providers/types.js";

// Throwaway local database only; Prisma loads .env, which may point at a shared one.
const enabled =
  /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") &&
  Boolean(process.env.FLIQ_ACCESS_SECRET);

const START = new Date("2026-11-14T10:00:00Z");
const HOUR = 60 * 60_000;

describe.skipIf(!enabled)("a daily limit the user sets on their own account", () => {
  if (!enabled) {
    it("needs DATABASE_URL pointing at a local database", () => {});
    return;
  }

  const database = createDatabase();
  const unit = unitOf(database);
  const config = loadConfig();
  const links: string[] = [];
  const sender: EmailSender = { sendSignInLink: async (_to, link) => void links.push(link) };
  const suffix = randomBytes(4).toString("hex");
  let clock = START.getTime();
  const now = () => new Date(clock);
  const adapter = sandboxAdapters(now)[0] as ProviderAdapter;

  const app = buildApp({
    config,
    unit,
    handlers: createHandlers({
      config,
      unit,
      email: sender,
      provisioner: new MockProvisioner(config.vaultAccount),
      vault: new MockVault({ registrar: "registrar.test.near", usdc: "usdc.test.near", now: () => 0n }),
      quotes: { adapters: [adapter], routing: DEFAULT_ROUTING_CONFIG, signals: NO_SIGNALS, now },
      payouts: { config, adapters: [adapter], velocity: DEFAULT_VELOCITY, now },
      now,
    }),
  });

  const userIds: string[] = [];
  const emails: string[] = [];

  async function signIn(label: string) {
    const email = `limits+${label}-${suffix}@example.test`;
    emails.push(email);
    await app.inject({ method: "POST", url: "/v1/auth/email-links", payload: { email } });
    const token = new URL(links.at(-1) as string).searchParams.get("token") as string;
    const session = (await app.inject({ method: "POST", url: "/v1/auth/email-links/verify", payload: { token } })).json();
    userIds.push(session.user.user_id);
    return { access: session.access_token as string, userId: session.user.user_id as string };
  }

  const call = (access: string, method: "GET" | "PUT" | "DELETE" | "POST", url: string, payload?: object, headers: object = {}) =>
    app.inject({ method, url: `/v1${url}`, ...(payload ? { payload } : {}), headers: { authorization: `Bearer ${access}`, ...headers } });
  const setLimit = (access: string, dailyLimit: string | null) => call(access, "PUT", "/me/limits", { daily_limit: dailyLimit });

  // The database stamps a payout with the real time, so it is moved onto the test's clock once created.
  async function cashOut(access: string, amount: string) {
    const quote = await call(access, "POST", "/quotes", { token: "usdc", currency: "ngn", amount, source_chain: "base" });
    const reply = await call(
      access,
      "POST",
      "/payouts",
      { quote_id: quote.json().quote_id, account: { bank: "058", number: "0123456789" }, refund_address: "0x1111111111111111111111111111111111111111" },
      { "idempotency-key": `k-${randomBytes(6).toString("hex")}` },
    );
    if (reply.statusCode === 201) await database.payout.update({ where: { id: reply.json().payout_id }, data: { createdAt: now() } });
    return reply;
  }

  beforeAll(async () => {
    await app.ready();
  }, 60_000);

  // Each test starts a week after the last, so one test's spending and waits never reach into the next.
  beforeEach(() => {
    clock = Math.max(clock, START.getTime()) + 7 * 24 * HOUR;
  });

  afterAll(async () => {
    await database.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.$executeRaw`DELETE FROM core.spend_holds WHERE user_id = ANY(${userIds}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.limit_changes WHERE user_id = ANY(${userIds}::text[])`;
      await tx.$executeRaw`DELETE FROM ledger.journal_lines WHERE entry_id IN (SELECT e.id FROM ledger.journal_entries e JOIN core.payouts p ON p.id = e.payout_id WHERE p.developer_id = ANY(${userIds}::text[]))`;
      await tx.$executeRaw`DELETE FROM ledger.journal_entries WHERE payout_id IN (SELECT id FROM core.payouts WHERE developer_id = ANY(${userIds}::text[]))`;
      await tx.$executeRaw`DELETE FROM core.payout_events WHERE payout_id IN (SELECT id FROM core.payouts WHERE developer_id = ANY(${userIds}::text[]))`;
      await tx.$executeRaw`DELETE FROM core.payouts WHERE developer_id = ANY(${userIds}::text[])`;
      await tx.$executeRaw`DELETE FROM core.recipients WHERE user_id = ANY(${userIds}::text[])`;
      await tx.$executeRaw`DELETE FROM core.quote_routes WHERE quote_id IN (SELECT id FROM core.quotes WHERE developer_id = ANY(${userIds}::text[]))`;
      await tx.$executeRaw`DELETE FROM core.quotes WHERE developer_id = ANY(${userIds}::text[])`;
      await tx.$executeRaw`DELETE FROM developer.idempotency_records WHERE scope = ANY(${userIds}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.sessions WHERE user_id = ANY(${userIds}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.users WHERE id = ANY(${userIds}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.email_links WHERE email = ANY(${emails}::text[])`;
    });
    await database.$disconnect();
  }, 60_000);

  it("starts with no limit, so nothing is held back", async () => {
    const user = await signIn("none");
    expect((await call(user.access, "GET", "/me/limits")).json()).toEqual({ daily_limit: null, spent_today: "0.00", remaining: null, pending: null });
    expect((await cashOut(user.access, "50.00")).statusCode).toBe(201);
  }, 60_000);

  it("applies a first limit and a lower limit at once", async () => {
    const user = await signIn("lower");
    expect((await setLimit(user.access, "500")).json()).toMatchObject({ daily_limit: "500.00", remaining: "500.00", pending: null });
    expect((await setLimit(user.access, "100.50")).json()).toMatchObject({ daily_limit: "100.50", pending: null });
  }, 60_000);

  it("makes a raise wait 24 hours, and keeps the old limit until then", async () => {
    const user = await signIn("raise");
    await setLimit(user.access, "100");
    const asked = (await setLimit(user.access, "2000")).json();
    expect(asked.daily_limit).toBe("100.00");
    expect(asked.pending).toEqual({ daily_limit: "2000.00", effective_at: new Date(clock + 24 * HOUR).toISOString() });
    expect((await cashOut(user.access, "150.00")).statusCode).toBe(422);

    clock += 23 * HOUR;
    expect((await call(user.access, "GET", "/me/limits")).json().daily_limit).toBe("100.00");
    clock += HOUR;
    expect((await call(user.access, "GET", "/me/limits")).json()).toMatchObject({ daily_limit: "2000.00", pending: null });
    expect((await cashOut(user.access, "150.00")).statusCode).toBe(201);
  }, 60_000);

  it("makes removing the limit wait too", async () => {
    const user = await signIn("remove");
    await setLimit(user.access, "100");
    const asked = (await setLimit(user.access, null)).json();
    expect(asked.daily_limit).toBe("100.00");
    expect(asked.pending.daily_limit).toBeNull();
    clock += 24 * HOUR;
    expect((await call(user.access, "GET", "/me/limits")).json()).toMatchObject({ daily_limit: null, pending: null });
  }, 60_000);

  it("cancels a waiting raise by the cancel call, by sending the current limit, or by lowering it", async () => {
    const user = await signIn("cancel");
    await setLimit(user.access, "100");
    await setLimit(user.access, "5000");
    expect((await call(user.access, "DELETE", "/me/limits/pending")).json()).toMatchObject({ daily_limit: "100.00", pending: null });
    await setLimit(user.access, "5000");
    expect((await setLimit(user.access, "100")).json()).toMatchObject({ daily_limit: "100.00", pending: null });
    await setLimit(user.access, "5000");
    expect((await setLimit(user.access, "40")).json()).toMatchObject({ daily_limit: "40.00", pending: null });
    clock += 25 * HOUR;
    expect((await call(user.access, "GET", "/me/limits")).json().daily_limit).toBe("40.00");
    const changes = await database.limitChange.findMany({ where: { userId: user.userId } });
    expect(changes).toHaveLength(3);
    expect(changes.every((change) => change.cancelledAt !== null)).toBe(true);
  }, 60_000);

  it("refuses a cash-out over what is left, with the numbers in the message, and creates nothing", async () => {
    const user = await signIn("cashout");
    await setLimit(user.access, "120");
    expect((await cashOut(user.access, "50.00")).statusCode).toBe(201);
    expect((await call(user.access, "GET", "/me/limits")).json()).toMatchObject({ spent_today: "50.00", remaining: "70.00" });

    const refused = await cashOut(user.access, "80.00");
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.code).toBe("daily_limit");
    expect(refused.json().error.message).toContain("$120.00");
    expect(refused.json().error.message).toContain("$70.00 left");
    expect(await database.payout.count({ where: { developerId: user.userId } })).toBe(1);
    expect((await cashOut(user.access, "70.00")).statusCode).toBe(201);
  }, 60_000);

  it("gives the room back 24 hours after the money left", async () => {
    const user = await signIn("window");
    await setLimit(user.access, "60");
    expect((await cashOut(user.access, "50.00")).statusCode).toBe(201);
    clock += 23 * HOUR;
    expect((await cashOut(user.access, "50.00")).statusCode).toBe(422);
    clock += HOUR + 1;
    expect((await cashOut(user.access, "50.00")).statusCode).toBe(201);
  }, 60_000);

  it("holds relayed sends against the same limit, once per delegate, and frees what did not move", async () => {
    const user = await signIn("sends");
    await setLimit(user.access, "100");
    const hold = (ref: string, units: bigint) => unit((tx) => holdSpend(tx, user.userId, `${suffix}:${ref}`, units, now()));

    await hold("a", 60_000_000n);
    await hold("a", 60_000_000n);
    expect((await call(user.access, "GET", "/me/limits")).json().spent_today).toBe("60.00");
    await expect(hold("b", 50_000_000n)).rejects.toMatchObject({ status: 422, code: "daily_limit" });

    await unit((tx) => releaseSpend(tx, `${suffix}:a`));
    expect((await call(user.access, "GET", "/me/limits")).json().spent_today).toBe("0.00");
    await hold("b", 50_000_000n);
    expect((await cashOut(user.access, "60.00")).statusCode).toBe(422);
  }, 60_000);

  it("holds two sends at once to the limit, never both", async () => {
    const user = await signIn("race");
    await setLimit(user.access, "100");
    const attempts = await Promise.allSettled(
      ["x", "y"].map((ref) => unit((tx) => holdSpend(tx, user.userId, `${suffix}:${ref}`, 70_000_000n, now()))),
    );
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
  }, 60_000);

  it("refuses a limit that is not a dollar amount", async () => {
    const user = await signIn("bad");
    for (const bad of ["-5", "abc", "10.123", ""]) expect((await setLimit(user.access, bad)).statusCode, bad).toBe(400);
    expect((await call(user.access, "PUT", "/me/limits", {})).statusCode).toBe(400);
  }, 60_000);

  it("words the warning for a raise and for a removal", () => {
    expect(limitChangeMessage("usr_1", "lim_1", 2_000_000_000n).body).toBe(
      "In 24 hours your daily limit becomes $2,000.00. If this wasn't you, open fliq and cancel it in Settings.",
    );
    expect(limitChangeMessage("usr_1", "lim_1", null).title).toBe("Your daily limit will be removed");
  });
});
