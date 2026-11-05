import { createHmac, randomBytes } from "node:crypto";
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
import { createWebhookHandler } from "../apps/api/src/webhooks.js";
import { DEFAULT_ROUTING_CONFIG, NO_SIGNALS } from "../packages/domain/routing.js";
import { PAYCREST_SIGNATURE_HEADER, createPaycrestAdapter } from "../packages/providers/paycrest/paycrest.js";
import { WEBHOOK_SETTLED_V2 } from "../packages/providers/paycrest/paycrest.fixtures.js";
import type { ProviderAdapter } from "../packages/providers/types.js";

// Throwaway local database only; Prisma loads .env, which may point at a shared one.
const enabled = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") && Boolean(process.env.FLIQ_ACCESS_SECRET);

const NOW = new Date("2026-11-05T10:00:00Z");
const SECRET = "whsec-test";

describe.skipIf(!enabled)("provider webhooks against a real database", () => {
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
  const email = `webhook+${suffix}@example.test`;

  // The sandbox provider creates the orders; Paycrest's own adapter verifies and reads the webhooks.
  const sandbox = sandboxAdapters(() => NOW)[0] as ProviderAdapter;
  const paycrest = createPaycrestAdapter({ apiKey: "k", webhookSecrets: [SECRET], deps: { alert: () => {} } });
  const adapter: ProviderAdapter = { ...sandbox, parseWebhook: (webhook) => paycrest.parseWebhook(webhook) };

  const unit = unitOf(database);
  const app = buildApp({
    config,
    unit,
    webhooks: createWebhookHandler({ unit, adapters: [adapter] }),
    handlers: createHandlers({
      config,
      unit,
      email: sender,
      provisioner: new MockProvisioner(config.vaultAccount),
      vault: new MockVault({ registrar: "registrar.test.near", usdc: "usdc.test.near", now: () => 0n }),
      quotes: { adapters: [adapter], routing: DEFAULT_ROUTING_CONFIG, signals: NO_SIGNALS, now: () => NOW },
      payouts: { config, adapters: [adapter], velocity: DEFAULT_VELOCITY, now: () => NOW },
    }),
  });

  let access: string;
  let userId: string;
  const providerOrders: string[] = [];

  async function newPayout() {
    const quote = await app.inject({
      method: "POST",
      url: "/v1/quotes",
      payload: { token: "usdc", currency: "ngn", amount: "50.00", source_chain: "base" },
      headers: { authorization: `Bearer ${access}` },
    });
    const reply = await app.inject({
      method: "POST",
      url: "/v1/payouts",
      payload: { quote_id: quote.json().quote_id, account: { bank: "058", number: "0123456789" }, refund_address: "frank.fliq.near" },
      headers: { authorization: `Bearer ${access}`, "idempotency-key": `k-${randomBytes(6).toString("hex")}` },
    });
    expect(reply.statusCode).toBe(201);
    providerOrders.push(reply.json().provider_order);
    return reply.json() as { payout_id: string; provider_order: string };
  }

  function deliver(payout: { payout_id: string; provider_order: string }, status: string, options: { signature?: string; event?: string } = {}) {
    const rawBody = JSON.stringify({
      ...WEBHOOK_SETTLED_V2,
      event: options.event ?? `payment_order.${status}`,
      data: { ...WEBHOOK_SETTLED_V2.data, id: payout.provider_order, reference: payout.payout_id, status },
    });
    const signature = options.signature ?? createHmac("sha256", SECRET).update(rawBody).digest("hex");
    return app.inject({
      method: "POST",
      url: "/v1/webhooks/mock",
      payload: rawBody,
      headers: { "content-type": "application/json", [PAYCREST_SIGNATURE_HEADER]: signature },
    });
  }

  const stateOf = async (payoutId: string) => (await database.payout.findUniqueOrThrow({ where: { id: payoutId } })).state;
  const historyOf = async (payoutId: string) =>
    (await database.payoutEvent.findMany({ where: { payoutId }, orderBy: { version: "asc" } })).map((event) => event.toState);

  beforeAll(async () => {
    await app.ready();
    await app.inject({ method: "POST", url: "/v1/auth/email-links", payload: { email } });
    const token = new URL(links.at(-1) as string).searchParams.get("token") as string;
    const session = (await app.inject({ method: "POST", url: "/v1/auth/email-links/verify", payload: { token } })).json();
    access = session.access_token;
    userId = session.user.user_id;
  }, 60_000);

  afterAll(async () => {
    await database.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      const ids = [userId];
      await tx.$executeRaw`DELETE FROM ledger.journal_lines WHERE entry_id IN (SELECT e.id FROM ledger.journal_entries e JOIN core.payouts p ON p.id = e.payout_id WHERE p.developer_id = ANY(${ids}::text[]))`;
      await tx.$executeRaw`DELETE FROM ledger.journal_entries WHERE payout_id IN (SELECT id FROM core.payouts WHERE developer_id = ANY(${ids}::text[]))`;
      await tx.$executeRaw`DELETE FROM core.payout_events WHERE payout_id IN (SELECT id FROM core.payouts WHERE developer_id = ANY(${ids}::text[]))`;
      await tx.$executeRaw`DELETE FROM core.payouts WHERE developer_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM messaging.inbox WHERE message_id LIKE ANY(${providerOrders.map((id) => `${id}:%`)}::text[])`;
      await tx.$executeRaw`DELETE FROM core.recipients WHERE user_id = ${userId}`;
      await tx.$executeRaw`DELETE FROM core.quote_routes WHERE quote_id IN (SELECT id FROM core.quotes WHERE developer_id = ${userId})`;
      await tx.$executeRaw`DELETE FROM core.quotes WHERE developer_id = ${userId}`;
      await tx.$executeRaw`DELETE FROM developer.idempotency_records WHERE scope = ${userId}`;
      await tx.$executeRaw`DELETE FROM auth.sessions WHERE user_id = ${userId}`;
      await tx.$executeRaw`DELETE FROM auth.users WHERE id = ${userId}`;
      await tx.$executeRaw`DELETE FROM auth.email_links WHERE email = ${email}`;
    });
    await database.$disconnect();
    await probe.$disconnect();
  }, 60_000);

  it("walks a payout from the deposit to settled, recording the states it skipped", async () => {
    const payout = await newPayout();
    expect((await deliver(payout, "deposited")).json()).toEqual({ outcome: "advanced" });
    expect(await stateOf(payout.payout_id)).toBe("with_provider");
    expect((await deliver(payout, "pending")).json()).toEqual({ outcome: "advanced" });
    expect((await deliver(payout, "settled")).json()).toEqual({ outcome: "advanced" });
    expect(await stateOf(payout.payout_id)).toBe("settled");
    expect(await historyOf(payout.payout_id)).toEqual(["created", "awaiting_deposit", "deposit_seen", "with_provider", "paying_out", "settled"]);
  }, 60_000);

  it("applies a repeated delivery once", async () => {
    const payout = await newPayout();
    expect((await deliver(payout, "deposited")).json()).toEqual({ outcome: "advanced" });
    expect((await deliver(payout, "deposited")).json()).toEqual({ outcome: "duplicate" });
    const replies = await Promise.all(Array.from({ length: 20 }, () => deliver(payout, "pending")));
    expect(replies.map((reply) => reply.statusCode)).toEqual(Array(20).fill(200));
    expect((await historyOf(payout.payout_id)).filter((state) => state === "paying_out")).toHaveLength(1);
  }, 60_000);

  it("refuses a bad signature and changes nothing", async () => {
    const payout = await newPayout();
    const reply = await deliver(payout, "settled", { signature: "00".repeat(32) });
    expect(reply.statusCode).toBe(401);
    expect(await stateOf(payout.payout_id)).toBe("awaiting_deposit");
  }, 60_000);

  it("ignores an older status that arrives after a newer one", async () => {
    const payout = await newPayout();
    await deliver(payout, "settled");
    const late = await deliver(payout, "deposited");
    expect(late.statusCode).toBe(200);
    expect(late.json()).toEqual({ outcome: "stale" });
    expect(await stateOf(payout.payout_id)).toBe("settled");
  }, 60_000);

  it("expires a payout whose deposit never came, and walks a refund to refunded", async () => {
    const unpaid = await newPayout();
    await deliver(unpaid, "expired");
    expect(await stateOf(unpaid.payout_id)).toBe("expired");

    const refunded = await newPayout();
    await deliver(refunded, "deposited");
    await deliver(refunded, "refunding");
    expect(await stateOf(refunded.payout_id)).toBe("refunding");
    await deliver(refunded, "refunded");
    expect(await stateOf(refunded.payout_id)).toBe("refunded");
  }, 60_000);

  it("answers 404 for an order it does not know, so the provider retries, and 200 for an event it cannot read", async () => {
    const unknown = await deliver({ payout_id: "pay_missing", provider_order: "missing-order" }, "settled");
    expect(unknown.statusCode).toBe(404);
    expect(await probe.inbox.count({ where: { messageId: { startsWith: "missing-order" } } })).toBe(0);

    const payout = await newPayout();
    const ignored = await deliver(payout, "settled", { event: "payment_order.something_new" });
    expect(ignored.statusCode).toBe(200);
    expect(ignored.json()).toEqual({ outcome: "ignored" });
    expect(await stateOf(payout.payout_id)).toBe("awaiting_deposit");
  }, 60_000);
});
