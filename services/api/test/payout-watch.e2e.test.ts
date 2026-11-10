import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockVault } from "../packages/chains/vault/index.js";
import { MockProvisioner } from "../apps/api/src/accounts.js";
import { buildApp } from "../apps/api/src/app.js";
import type { EmailSender } from "../apps/api/src/auth/email-links.js";
import { loadConfig } from "../apps/api/src/config.js";
import { createDatabase, unitOf } from "../apps/api/src/db.js";
import { createHandlers } from "../apps/api/src/handlers.js";
import { watchPayouts } from "../apps/api/src/payout-watch.js";
import { DEFAULT_VELOCITY } from "../apps/api/src/payouts.js";
import { sandboxAdapters } from "../apps/api/src/sandbox.js";
import { DEFAULT_ROUTING_CONFIG, NO_SIGNALS } from "../packages/domain/routing.js";
import { ProviderError } from "../packages/providers/errors.js";
import type { OrderSnapshot, ProviderAdapter } from "../packages/providers/types.js";

// Throwaway local database only; Prisma loads .env, which may point at a shared one.
const enabled =
  /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") &&
  Boolean(process.env.FLIQ_ACCESS_SECRET);

const NOW = new Date("2026-11-05T10:00:00Z");

describe.skipIf(!enabled)("polling providers as the backstop to webhooks", () => {
  if (!enabled) {
    it("needs DATABASE_URL pointing at a local database", () => {});
    return;
  }

  const database = createDatabase();
  const unit = unitOf(database);
  const config = loadConfig();
  const links: string[] = [];
  const sender: EmailSender = { sendSignInLink: async (_to, link) => void links.push(link) };
  const email = `watch+${randomBytes(4).toString("hex")}@example.test`;
  const sandbox = sandboxAdapters(() => NOW)[0] as ProviderAdapter;

  // What the provider answers when polled, per order, set by each test.
  const answers = new Map<string, OrderSnapshot | null>();
  const confirmed: string[] = [];
  let failNextCreate = false;
  // Pays the account but cannot read names, like TransFi or Fonbnk.
  const nameless: ProviderAdapter = {
    ...sandbox,
    verifyAccount: async (check) =>
      (await sandbox.verifyAccount(check)).found ? { found: true, accountName: null } : { found: false },
    async createOrder(request) {
      if (failNextCreate) {
        failNextCreate = false;
        throw new ProviderError("mock", "createOrder", "unavailable", "timed out");
      }
      return sandbox.createOrder(request);
    },
    getOrder: async (lookup) =>
      answers.get("providerOrderId" in lookup ? lookup.providerOrderId : lookup.reference) ?? null,
    async confirmFunding(providerOrderId, txHash) {
      confirmed.push(`${providerOrderId}:${txHash}`);
      return { providerOrderId, status: "processing" };
    },
  };
  // A second provider that can read the name the first cannot.
  const reader: ProviderAdapter = { ...sandbox, id: "paycrest" };

  const app = buildApp({
    config,
    unit,
    handlers: createHandlers({
      config,
      unit,
      email: sender,
      provisioner: new MockProvisioner(config.vaultAccount),
      vault: new MockVault({ registrar: "registrar.test.near", usdc: "usdc.test.near", now: () => 0n }),
      quotes: { adapters: [nameless], routing: DEFAULT_ROUTING_CONFIG, signals: NO_SIGNALS, now: () => NOW },
      payouts: { config, adapters: [nameless, reader], velocity: DEFAULT_VELOCITY, now: () => NOW },
    }),
  });

  let access: string;
  let userId: string;
  const created: string[] = [];

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
      payload: {
        quote_id: quote.json().quote_id,
        account: { bank: "058", number: "0123456789" },
        refund_address: "0x1111111111111111111111111111111111111111",
      },
      headers: {
        authorization: `Bearer ${access}`,
        "idempotency-key": `k-${randomBytes(6).toString("hex")}`,
      },
    });
    expect(reply.statusCode).toBe(201);
    created.push(reply.json().payout_id);
    return reply.json() as {
      payout_id: string;
      provider_order: string | null;
      account_name: string;
      state: string;
    };
  }

  const watch = (options: { now?: Date; oneClick?: Parameters<typeof watchPayouts>[0]["oneClick"] } = {}) =>
    watchPayouts({
      unit,
      adapters: [nameless],
      now: () => options.now ?? NOW,
      log: () => {},
      windowMs: 365 * 24 * 60 * 60_000,
      batch: 500,
      ...(options.oneClick ? { oneClick: options.oneClick } : {}),
    });
  const stateOf = async (payoutId: string) =>
    (await database.payout.findUniqueOrThrow({ where: { id: payoutId } })).state;

  beforeAll(async () => {
    await app.ready();
    await app.inject({ method: "POST", url: "/v1/auth/email-links", payload: { email } });
    const token = new URL(links.at(-1) as string).searchParams.get("token") as string;
    const session = (
      await app.inject({ method: "POST", url: "/v1/auth/email-links/verify", payload: { token } })
    ).json();
    access = session.access_token;
    userId = session.user.user_id;
  }, 60_000);

  afterAll(async () => {
    await database.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      const ids = [userId];
      await tx.$executeRaw`DELETE FROM messaging.inbox WHERE message_id LIKE ANY(${created.map((id) => `poll:${id}:%`)}::text[])`;
      await tx.$executeRaw`DELETE FROM ledger.journal_lines WHERE entry_id IN (SELECT e.id FROM ledger.journal_entries e JOIN core.payouts p ON p.id = e.payout_id WHERE p.developer_id = ANY(${ids}::text[]))`;
      await tx.$executeRaw`DELETE FROM ledger.journal_entries WHERE payout_id IN (SELECT id FROM core.payouts WHERE developer_id = ANY(${ids}::text[]))`;
      await tx.$executeRaw`DELETE FROM core.payout_events WHERE payout_id IN (SELECT id FROM core.payouts WHERE developer_id = ANY(${ids}::text[]))`;
      await tx.$executeRaw`DELETE FROM core.payouts WHERE developer_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM core.recipients WHERE user_id = ${userId}`;
      await tx.$executeRaw`DELETE FROM core.quote_routes WHERE quote_id IN (SELECT id FROM core.quotes WHERE developer_id = ${userId})`;
      await tx.$executeRaw`DELETE FROM core.quotes WHERE developer_id = ${userId}`;
      await tx.$executeRaw`DELETE FROM developer.idempotency_records WHERE scope = ${userId}`;
      await tx.$executeRaw`DELETE FROM auth.sessions WHERE user_id = ${userId}`;
      await tx.$executeRaw`DELETE FROM auth.users WHERE id = ${userId}`;
      await tx.$executeRaw`DELETE FROM auth.email_links WHERE email = ${email}`;
    });
    await database.$disconnect();
  }, 60_000);

  it("takes the account name from another provider when the route's provider cannot read it", async () => {
    const payout = await newPayout();
    expect(payout.account_name).toBe("DARA OKONKWO");
  }, 60_000);

  it("moves a payout whose webhooks never came, once, however often it polls", async () => {
    const payout = await newPayout();
    answers.set(payout.provider_order as string, {
      providerOrderId: payout.provider_order as string,
      status: "paid",
      fiatReference: "000013251029140213",
    });
    const first = await watch();
    expect(first).toContainEqual({ payoutId: payout.payout_id, outcome: "advanced" });
    expect(await stateOf(payout.payout_id)).toBe("settled");
    const again = await watch();
    expect(again.find((result) => result.payoutId === payout.payout_id)).toBeUndefined();
  }, 60_000);

  it("tells the provider which transfer paid it once the 1Click leg has delivered", async () => {
    const payout = await newPayout();
    const order = payout.provider_order as string;
    answers.set(order, { providerOrderId: order, status: "awaiting_deposit" });
    await database.payout.update({
      where: { id: payout.payout_id },
      data: { routeKind: "intents", depositAddress: "1click-deposit", depositChain: "near" },
    });
    const oneClick = {
      status: async () => ({
        status: "SUCCESS" as const,
        updatedAt: NOW,
        depositedAmount: undefined,
        amountIn: undefined,
        amountOut: undefined,
        refundedAmount: undefined,
        refundReason: undefined,
        originTxHashes: [],
        destinationTxHashes: ["0xdelivered"],
        nearTxHashes: [],
      }),
    };
    await watch({ oneClick });
    expect(confirmed).toContain(`${order}:0xdelivered`);
    expect(await stateOf(payout.payout_id)).toBe("paying_out");
  }, 60_000);

  it("fails a payout whose order the provider never received, but only after waiting", async () => {
    failNextCreate = true;
    const payout = await newPayout();
    expect(payout.state).toBe("provider_timeout");
    await watch();
    expect(await stateOf(payout.payout_id)).toBe("awaiting_recon");
    await watch({ now: new Date(Date.now() + 11 * 60_000) });
    const failed = await database.payout.findUniqueOrThrow({ where: { id: payout.payout_id } });
    expect(failed).toMatchObject({ state: "failed", failureReason: "provider_order_not_found" });
  }, 60_000);
});
