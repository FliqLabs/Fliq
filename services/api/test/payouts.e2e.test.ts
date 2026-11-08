import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockVault } from "../packages/chains/vault/index.js";
import { MockProvisioner } from "../apps/api/src/accounts.js";
import { buildApp } from "../apps/api/src/app.js";
import type { EmailSender } from "../apps/api/src/auth/email-links.js";
import { loadConfig } from "../apps/api/src/config.js";
import { createDatabase, unitOf } from "../apps/api/src/db.js";
import { createHandlers } from "../apps/api/src/handlers.js";
import { DEFAULT_VELOCITY } from "../apps/api/src/payouts.js";
import { sandboxAdapters } from "../apps/api/src/sandbox.js";
import { DEFAULT_ROUTING_CONFIG, NO_SIGNALS } from "../packages/domain/routing.js";
import { ProviderError } from "../packages/providers/errors.js";
import type { CreateOrderRequest, ProviderAdapter } from "../packages/providers/types.js";

// Throwaway local database only; Prisma loads .env, which may point at a shared one.
const enabled = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") && Boolean(process.env.FLIQ_ACCESS_SECRET);

const NOW = new Date("2026-11-05T10:00:00Z");
const ACCOUNT = { bank: "058", number: "0123456789" };
const UNNAMED = { bank: "058", number: "0000000002" };
// Banks that time out, and ones that answer with something the adapter cannot read.
const SLOW_BANK = "0000000003";
const BROKEN_BANK = "0000000004";

describe.skipIf(!enabled)("payout creation against a real database", () => {
  if (!enabled) {
    it("needs DATABASE_URL pointing at a local database", () => {});
    return;
  }

  const database = createDatabase();
  const probe = new PrismaClient();
  const config = loadConfig();
  const links: string[] = [];
  const sender: EmailSender = { sendSignInLink: async (_to, link) => void links.push(link) };
  const suffix = randomBytes(4).toString("hex");
  const emails: string[] = [];

  const base = sandboxAdapters(() => NOW)[0] as ProviderAdapter;
  const orderCalls: { payoutId: string; committedLedgerEntries: number }[] = [];
  let reject = false;
  const adapter: ProviderAdapter = {
    ...base,
    // The bank answers "OK" with no name for this account, as Paycrest does for banks it cannot look up.
    verifyAccount: async (check) => {
      if (check.accountNumber === SLOW_BANK) throw new ProviderError("mock", "verifyAccount", "timeout", "no answer");
      if (check.accountNumber === BROKEN_BANK) throw new ProviderError("mock", "verifyAccount", "invalid_response", "bad body");
      return check.accountNumber === UNNAMED.number ? { found: true, accountName: null } : base.verifyAccount(check);
    },
    async createOrder(request: CreateOrderRequest) {
      const committedLedgerEntries = await probe.journalEntry.count({ where: { payoutId: request.payoutId, postingType: "ORDER_COMMITTED" } });
      orderCalls.push({ payoutId: request.payoutId, committedLedgerEntries });
      if (reject) throw new ProviderError("mock", "createOrder", "rejected", "not allowed");
      return base.createOrder(request);
    },
  };

  function appAt(now: Date, velocity = DEFAULT_VELOCITY, logger = false) {
    return buildApp({
      config,
      logger,
      unit: unitOf(database),
      handlers: createHandlers({
        config,
        unit: unitOf(database),
        email: sender,
        provisioner: new MockProvisioner(config.vaultAccount),
        vault: new MockVault({ registrar: "registrar.test.near", usdc: "usdc.test.near", now: () => 0n }),
        quotes: { adapters: [adapter], routing: DEFAULT_ROUTING_CONFIG, signals: NO_SIGNALS, now: () => NOW },
        payouts: { config, adapters: [adapter], velocity, now: () => now },
      }),
    });
  }
  const app = appAt(NOW);

  async function signIn(label: string) {
    const email = `payout+${label}-${suffix}@example.test`;
    emails.push(email);
    await app.inject({ method: "POST", url: "/v1/auth/email-links", payload: { email } });
    const token = new URL(links.at(-1) as string).searchParams.get("token") as string;
    const session = (await app.inject({ method: "POST", url: "/v1/auth/email-links/verify", payload: { token } })).json();
    return { access: session.access_token as string, userId: session.user.user_id as string };
  }

  const quote = async (access: string, amount = "50.00") => {
    const reply = await app.inject({
      method: "POST",
      url: "/v1/quotes",
      payload: { token: "usdc", currency: "ngn", amount, source_chain: "base" },
      headers: { authorization: `Bearer ${access}` },
    });
    expect(reply.statusCode).toBe(200);
    return reply.json().quote_id as string;
  };

  const pay = (target: typeof app, access: string, key: string | null, body: object) =>
    target.inject({
      method: "POST",
      url: "/v1/payouts",
      payload: body,
      headers: { authorization: `Bearer ${access}`, ...(key ? { "idempotency-key": key } : {}) },
    });
  const body = (quoteId: string, extra: object = {}) => ({ quote_id: quoteId, account: ACCOUNT, refund_address: "frank.fliq.near", ...extra });

  let frank: { access: string; userId: string };
  beforeAll(async () => {
    await app.ready();
    frank = await signIn("frank");
  }, 60_000);

  afterAll(async () => {
    await database.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      const users = await tx.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
      const ids = users.map((user) => user.id);
      await tx.$executeRaw`DELETE FROM ledger.journal_lines WHERE entry_id IN (SELECT e.id FROM ledger.journal_entries e JOIN core.payouts p ON p.id = e.payout_id WHERE p.developer_id = ANY(${ids}::text[]))`;
      await tx.$executeRaw`DELETE FROM ledger.journal_entries WHERE payout_id IN (SELECT id FROM core.payouts WHERE developer_id = ANY(${ids}::text[]))`;
      await tx.$executeRaw`DELETE FROM core.payout_events WHERE payout_id IN (SELECT id FROM core.payouts WHERE developer_id = ANY(${ids}::text[]))`;
      await tx.$executeRaw`DELETE FROM core.payouts WHERE developer_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM core.recipients WHERE user_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM core.quote_routes WHERE quote_id IN (SELECT id FROM core.quotes WHERE developer_id = ANY(${ids}::text[]))`;
      await tx.$executeRaw`DELETE FROM core.quotes WHERE developer_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM developer.idempotency_records WHERE scope = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.sessions WHERE user_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.users WHERE id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.email_links WHERE email = ANY(${emails}::text[])`;
    });
    await database.$disconnect();
    await probe.$disconnect();
  }, 60_000);

  it("commits the payout and its ledger entry, then asks the provider, and returns the deposit instruction", async () => {
    const quoteId = await quote(frank.access);
    const before = orderCalls.length;
    const reply = await pay(app, frank.access, `k-${suffix}-1`, body(quoteId));
    expect(reply.statusCode).toBe(201);
    const payout = reply.json();
    expect(payout).toMatchObject({
      state: "awaiting_deposit",
      account_name: "DARA OKONKWO",
      account: ACCOUNT,
      amount: "50.00",
      receive: 68816,
      currency: "ngn",
      rate: 1376.32,
      fees: { provider: 25000, network: 9400, total: 34400 },
      provider: "mock",
      deposit: { chain: "simulated", amount: "50.00" },
      vault_receipt: null,
      bank_reference: null,
    });
    expect(payout.deposit.address).toMatch(/^mock:/);
    expect(payout.provider_order).toMatch(/^mo_/);
    expect(payout.history.map((entry: { state: string }) => entry.state)).toEqual(["created", "awaiting_deposit"]);

    expect(orderCalls.slice(before)).toEqual([{ payoutId: payout.payout_id, committedLedgerEntries: 1 }]);
    const recipient = await database.recipient.findFirstOrThrow({ where: { userId: frank.userId } });
    expect(Buffer.from(recipient.accountCipher).toString("utf8")).not.toContain(ACCOUNT.number);
    expect(Buffer.from(recipient.nameCipher).toString("utf8")).not.toContain("DARA");

    const fetched = await app.inject({ method: "GET", url: `/v1/payouts/${payout.payout_id}`, headers: { authorization: `Bearer ${frank.access}` } });
    expect(fetched.json()).toEqual(payout);
  }, 60_000);

  it("replays the stored answer for the same key and refuses the same key with a different request", async () => {
    const quoteId = await quote(frank.access);
    const first = await pay(app, frank.access, `k-${suffix}-2`, body(quoteId));
    const again = await pay(app, frank.access, `k-${suffix}-2`, body(quoteId));
    expect(again.statusCode).toBe(201);
    expect(again.json()).toEqual(first.json());
    expect(await database.payout.count({ where: { quoteId } })).toBe(1);

    const mismatch = await pay(app, frank.access, `k-${suffix}-2`, body(quoteId, { client_reference: "other" }));
    expect(mismatch.statusCode).toBe(422);
    expect(mismatch.json().error.code).toBe("idempotency_mismatch");
    expect((await pay(app, frank.access, null, body(quoteId))).statusCode).toBe(400);
  }, 60_000);

  it("creates exactly one payout and one provider order from 50 concurrent identical calls", async () => {
    const quoteId = await quote(frank.access);
    const before = orderCalls.length;
    const replies = await Promise.all(Array.from({ length: 50 }, () => pay(app, frank.access, `k-${suffix}-race`, body(quoteId))));
    expect(replies.every((reply) => reply.statusCode === 201 || reply.statusCode === 409)).toBe(true);
    expect(replies.filter((reply) => reply.statusCode === 201).length).toBeGreaterThan(0);
    expect(await database.payout.count({ where: { quoteId } })).toBe(1);
    expect(orderCalls.length - before).toBe(1);
    const created = replies.filter((reply) => reply.statusCode === 201).map((reply) => reply.json());
    expect(new Set(created.map((payout) => payout.payout_id)).size).toBe(1);
    const settled = await pay(app, frank.access, `k-${suffix}-race`, body(quoteId));
    expect(settled.statusCode).toBe(201);
  }, 120_000);

  it("lets a quote fund only one payout", async () => {
    const quoteId = await quote(frank.access);
    const results = await Promise.all([
      pay(app, frank.access, `k-${suffix}-a`, body(quoteId, { client_reference: "ref-a" })),
      pay(app, frank.access, `k-${suffix}-b`, body(quoteId, { client_reference: "ref-b" })),
    ]);
    expect(results.map((reply) => reply.statusCode).sort()).toEqual([201, 409]);
    expect(await database.payout.count({ where: { quoteId } })).toBe(1);
  }, 60_000);

  it("refuses a duplicate client_reference", async () => {
    const first = await pay(app, frank.access, `k-${suffix}-c1`, body(await quote(frank.access), { client_reference: "invoice-7" }));
    expect(first.statusCode).toBe(201);
    const second = await pay(app, frank.access, `k-${suffix}-c2`, body(await quote(frank.access), { client_reference: "invoice-7" }));
    expect(second.statusCode).toBe(409);
  }, 60_000);

  it("refuses an expired quote, someone else's quote and an account the bank cannot find", async () => {
    const quoteId = await quote(frank.access);
    const late = appAt(new Date(NOW.getTime() + 200_000));
    const expired = await pay(late, frank.access, `k-${suffix}-e`, body(quoteId));
    expect(expired.statusCode).toBe(422);
    expect(expired.json().error.code).toBe("quote_expired");

    const other = await signIn("other");
    expect((await pay(app, other.access, `k-${suffix}-o`, body(quoteId))).statusCode).toBe(404);

    const unknown = await pay(app, frank.access, `k-${suffix}-u`, body(await quote(frank.access), { account: { bank: "058", number: "0000000001" } }));
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json().error.code).toBe("account_not_found");
    expect((await pay(app, frank.access, `k-${suffix}-bad`, body(await quote(frank.access), { account: { bank: "058", number: "12ab" } }))).statusCode).toBe(400);

    const slow = await pay(app, frank.access, `k-${suffix}-slow`, body(await quote(frank.access), { account: { bank: "058", number: SLOW_BANK } }));
    expect(slow.statusCode).toBe(422);
    expect(slow.json().error.code).toBe("route_unavailable");
    const broken = await pay(app, frank.access, `k-${suffix}-broken`, body(await quote(frank.access), { account: { bank: "058", number: BROKEN_BANK } }));
    expect(broken.statusCode).toBe(422);
    expect(broken.json().error.code).toBe("account_not_found");
    expect((await pay(app, frank.access, `k-${suffix}-norefund`, { quote_id: await quote(frank.access), account: ACCOUNT })).statusCode).toBe(400);
  }, 120_000);

  it("keeps a payout out of reach of other users", async () => {
    const reply = await pay(app, frank.access, `k-${suffix}-priv`, body(await quote(frank.access)));
    const other = await signIn("snoop");
    const stolen = await app.inject({ method: "GET", url: `/v1/payouts/${reply.json().payout_id}`, headers: { authorization: `Bearer ${other.access}` } });
    expect(stolen.statusCode).toBe(404);
    expect(stolen.body).not.toContain("DARA");
  }, 60_000);

  it("cannot be talked past the daily limit by concurrent requests", async () => {
    const capped = appAt(NOW, { maxPerDay: 3, maxTokenUnitsPerDay: DEFAULT_VELOCITY.maxTokenUnitsPerDay });
    const user = await signIn("capped");
    const quotes = await Promise.all(Array.from({ length: 8 }, (_, index) => quote(user.access, `${10 + index}.00`)));
    const replies = await Promise.all(quotes.map((quoteId, index) => pay(capped, user.access, `k-${suffix}-v${index}`, body(quoteId))));
    expect(replies.filter((reply) => reply.statusCode === 201)).toHaveLength(3);
    const refused = replies.filter((reply) => reply.statusCode === 422);
    expect(refused).toHaveLength(5);
    expect(refused.every((reply) => reply.json().error.code === "velocity_limit")).toBe(true);
    expect(await database.payout.count({ where: { developerId: user.userId } })).toBe(3);
  }, 120_000);

  it("holds an unknown provider outcome instead of failing, keeping the commitment", async () => {
    for (const [index, amount] of ["50.03", "50.04"].entries()) {
      const quoteId = await quote(frank.access, amount);
      const reply = await pay(app, frank.access, `k-${suffix}-t${index}`, body(quoteId));
      expect(reply.statusCode).toBe(201);
      expect(reply.json().state).toBe("provider_timeout");
      expect(reply.json().deposit.address).toBe("");
      const payout = await database.payout.findFirstOrThrow({ where: { quoteId } });
      expect(payout.failureReason).toBeNull();
      expect(await database.journalEntry.count({ where: { payoutId: payout.id, postingType: "ORDER_COMMITTED" } })).toBe(1);
      expect((await pay(app, frank.access, `k-${suffix}-t${index}`, body(quoteId))).json()).toEqual(reply.json());
    }
  }, 60_000);

  it("fails the payout only when the provider definitely rejects it", async () => {
    reject = true;
    try {
      const quoteId = await quote(frank.access, "61.00");
      const reply = await pay(app, frank.access, `k-${suffix}-r`, body(quoteId));
      expect(reply.statusCode).toBe(422);
      expect(reply.json().error.code).toBe("provider_rejected");
      const payout = await database.payout.findFirstOrThrow({ where: { quoteId }, include: { events: { orderBy: { version: "asc" } } } });
      expect(payout).toMatchObject({ state: "failed", failureReason: "provider_rejected" });
      expect(payout.events.map((event) => event.toState)).toEqual(["created", "failed"]);
      expect((await pay(app, frank.access, `k-${suffix}-r`, body(quoteId))).statusCode).toBe(422);
    } finally {
      reject = false;
    }
  }, 60_000);
  it("lists institutions without signing in and verifies account names with the bank", async () => {
    const list = await app.inject({ method: "GET", url: "/v1/institutions?country=ng" });
    expect(list.statusCode).toBe(200);
    expect(list.json().items.map((item: { code: string }) => item.code)).toEqual(expect.arrayContaining(["058", "044", "999992"]));
    expect(list.json().items.find((item: { code: string }) => item.code === "058")).toMatchObject({ name: "GTBank", type: "bank", country: "ng", logo_key: "gtbank" });
    expect((await app.inject({ method: "GET", url: "/v1/institutions?country=xx" })).statusCode).toBe(400);

    const auth = { authorization: `Bearer ${frank.access}` };
    const found = await app.inject({ method: "POST", url: "/v1/accounts/verify", payload: ACCOUNT, headers: auth });
    expect(found.json()).toEqual({ bank: "058", number: "0123456789", account_name: "DARA OKONKWO", institution: "GTBank", name_verified: true });
    const missing = await app.inject({ method: "POST", url: "/v1/accounts/verify", payload: { bank: "058", number: "0000000001" }, headers: auth });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("account_not_found");
    expect((await app.inject({ method: "POST", url: "/v1/accounts/verify", payload: { bank: "058", number: "12" }, headers: auth })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/accounts/verify", payload: ACCOUNT })).statusCode).toBe(401);
  }, 60_000);

  it("saves, lists, de-duplicates and removes recipients without ever returning the full number", async () => {
    const user = await signIn("saver");
    const auth = { authorization: `Bearer ${user.access}` };
    const call = (method: "GET" | "POST" | "DELETE", url: string, payload?: object) => app.inject({ method, url: `/v1${url}`, payload, headers: auth });

    const first = await call("POST", "/recipients", ACCOUNT);
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ account_name: "DARA OKONKWO", account_last4: "6789", bank: { code: "058", name: "GTBank", logo_key: "gtbank" } });
    expect(first.body).not.toContain(ACCOUNT.number);

    const again = await call("POST", "/recipients", ACCOUNT);
    expect(again.statusCode).toBe(200);
    expect(again.json().recipient_id).toBe(first.json().recipient_id);
    expect((await call("GET", "/recipients")).json().items).toHaveLength(1);
    expect((await call("POST", "/recipients", { bank: "058", number: "0000000001" })).statusCode).toBe(404);

    const stranger = await signIn("stranger");
    expect((await app.inject({ method: "DELETE", url: `/v1/recipients/${first.json().recipient_id}`, headers: { authorization: `Bearer ${stranger.access}` } })).statusCode).toBe(404);

    expect((await call("DELETE", `/recipients/${first.json().recipient_id}`)).statusCode).toBe(204);
    expect((await call("GET", "/recipients")).json().items).toEqual([]);
    expect((await call("DELETE", `/recipients/${first.json().recipient_id}`)).statusCode).toBe(404);

    const revived = await call("POST", "/recipients", ACCOUNT);
    expect(revived.statusCode).toBe(201);
    expect(revived.json().recipient_id).toBe(first.json().recipient_id);
  }, 120_000);

  it("keeps recipients made by paying out of the saved list", async () => {
    const user = await signIn("payer");
    const auth = { authorization: `Bearer ${user.access}` };
    const quoted = await app.inject({ method: "POST", url: "/v1/quotes", payload: { token: "usdc", currency: "ngn", amount: "50.00", source_chain: "base" }, headers: auth });
    const paid = await pay(app, user.access, `k-${suffix}-payer`, body(quoted.json().quote_id));
    expect(paid.statusCode).toBe(201);
    expect((await app.inject({ method: "GET", url: "/v1/recipients", headers: auth })).json().items).toEqual([]);
  }, 60_000);

  it("writes no account number or name to the logs or to error bodies", async () => {
    const written: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      written.push(chunk.toString());
      return true;
    }) as typeof process.stdout.write;
    const bodies: string[] = [];
    try {
      const logged = appAt(NOW, DEFAULT_VELOCITY, true);
      const user = await signIn("logger");
      const auth = { authorization: `Bearer ${user.access}` };
      const send = async (method: "POST" | "GET", url: string, payload?: object) => bodies.push((await logged.inject({ method, url: `/v1${url}`, payload, headers: auth })).body);
      await send("POST", "/accounts/verify", ACCOUNT);
      await send("POST", "/accounts/verify", { bank: "058", number: "0000000001" });
      await send("POST", "/accounts/verify", { bank: "058", number: "12ab" });
      await send("POST", "/recipients", ACCOUNT);
      await send("POST", "/recipients", { bank: "058", number: "0000000001" });
      await send("POST", "/payouts", { quote_id: "q_missing", account: ACCOUNT });
      await send("POST", "/payouts", { quote_id: "q_missing", account: { bank: "058", number: "0000000001" }, refund_address: "x" });
      await logged.close();
    } finally {
      process.stdout.write = original;
    }
    const everything = [...written, ...bodies.filter((text) => !text.includes('"account_name"'))].join("\n");
    expect(everything.length).toBeGreaterThan(0);
    for (const secret of ["0123456789", "0000000001", "DARA OKONKWO", "12ab"]) expect(everything, secret).not.toContain(secret);
  }, 120_000);
  it("asks for a name when the bank cannot give one, and says it was not confirmed", async () => {
    const user = await signIn("unnamed");
    const auth = { authorization: `Bearer ${user.access}` };
    const verify = (payload: object) => app.inject({ method: "POST", url: "/v1/accounts/verify", payload, headers: auth });

    const without = await verify(UNNAMED);
    expect(without.statusCode).toBe(422);
    expect(without.json().error.code).toBe("account_name_required");
    expect((await verify({ ...UNNAMED, account_name: "   " })).statusCode).toBe(422);
    expect((await verify({ ...UNNAMED, account_name: "ADA LOVELACE" })).json()).toMatchObject({ account_name: "ADA LOVELACE", name_verified: false });

    const saved = await app.inject({ method: "POST", url: "/v1/recipients", payload: { ...UNNAMED, account_name: "ADA LOVELACE" }, headers: auth });
    expect(saved.statusCode).toBe(201);
    expect(saved.json().account_name).toBe("ADA LOVELACE");

    const quoteId = await quote(user.access);
    expect((await pay(app, user.access, `k-${suffix}-n1`, body(quoteId, { account: UNNAMED }))).json().error.code).toBe("account_name_required");
    const paid = await pay(app, user.access, `k-${suffix}-n2`, body(quoteId, { account: UNNAMED, account_name: "ADA LOVELACE" }));
    expect(paid.statusCode).toBe(201);
    expect(paid.json().account_name).toBe("ADA LOVELACE");
  }, 120_000);
});
