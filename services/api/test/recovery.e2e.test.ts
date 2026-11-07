import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockProvisioner } from "../apps/api/src/accounts.js";
import { buildApp } from "../apps/api/src/app.js";
import type { EmailSender } from "../apps/api/src/auth/email-links.js";
import { loadConfig } from "../apps/api/src/config.js";
import { createDatabase, unitOf } from "../apps/api/src/db.js";
import { createHandlers } from "../apps/api/src/handlers.js";
import { DEFAULT_VELOCITY } from "../apps/api/src/payouts.js";
import { sandboxAdapters } from "../apps/api/src/sandbox.js";
import { MockVault } from "../packages/chains/vault/index.js";
import { DEFAULT_ROUTING_CONFIG, NO_SIGNALS } from "../packages/domain/routing.js";
import { transitionPayout } from "../packages/domain/transition.js";
import type { PayoutState } from "../packages/domain/payout-state.js";
import type { ProviderAdapter } from "../packages/providers/types.js";

// Throwaway local database only; Prisma loads .env, which may point at a shared one.
const enabled = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") && Boolean(process.env.FLIQ_ACCESS_SECRET);
const ACCOUNT = { bank: "058", number: "0123456789" };

describe.skipIf(!enabled)("recovering a payout that did not land", () => {
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
  const emails: string[] = [];

  // Two sandbox providers, so a retry has somewhere else to go.
  const sandbox = sandboxAdapters()[0] as ProviderAdapter;
  const as = (id: string): ProviderAdapter => ({
    ...sandbox,
    id: id as ProviderAdapter["id"],
    quote: async (request) => ({ ...(await sandbox.quote(request)), provider: id as ProviderAdapter["id"] }),
    capabilities: () => ({ ...sandbox.capabilities(), provider: id as ProviderAdapter["id"] }),
  });
  const adapters = [as("paycrest"), as("busha")];
  const app = buildApp({
    config,
    unit,
    logger: Boolean(process.env.E2E_LOG),
    handlers: createHandlers({
      config,
      unit,
      email: sender,
      provisioner: new MockProvisioner(config.vaultAccount),
      vault: new MockVault({ registrar: "registrar.test.near", usdc: "usdc.test.near", now: () => 0n }),
      quotes: { adapters, routing: DEFAULT_ROUTING_CONFIG, signals: NO_SIGNALS, now: () => new Date() },
      payouts: { config, adapters, velocity: DEFAULT_VELOCITY, now: () => new Date() },
    }),
  });

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await database.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      const users = await tx.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
      const ids = users.map((user) => user.id);
      await tx.$executeRaw`DELETE FROM messaging.outbox WHERE routing_key IN (SELECT id FROM core.payouts WHERE developer_id = ANY(${ids}::text[]))`;
      await tx.$executeRaw`DELETE FROM core.payout_claims WHERE user_id = ANY(${ids}::text[])`;
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
  }, 60_000);

  async function signIn(label: string) {
    const email = `recovery+${label}-${suffix}@example.test`;
    emails.push(email);
    await app.inject({ method: "POST", url: "/v1/auth/email-links", payload: { email } });
    const token = new URL(links.at(-1) as string).searchParams.get("token") as string;
    const session = (await app.inject({ method: "POST", url: "/v1/auth/email-links/verify", payload: { token } })).json();
    return { authorization: `Bearer ${session.access_token}` };
  }

  const key = () => `k-${randomBytes(6).toString("hex")}`;

  async function pay(headers: Record<string, string>, extra: Record<string, string> = {}) {
    const quote = await app.inject({ method: "POST", url: "/v1/quotes", payload: { token: "usdc", currency: "ngn", amount: "50.00", source_chain: "base" }, headers });
    expect(quote.statusCode, quote.body).toBe(200);
    const reply = await app.inject({
      method: "POST",
      url: "/v1/payouts",
      payload: { quote_id: quote.json().quote_id, account: ACCOUNT, refund_address: "frank.fliq.near", ...extra },
      headers: { ...headers, "idempotency-key": key() },
    });
    expect(reply.statusCode, reply.body).toBe(201);
    return reply.json() as { payout_id: string; provider: string };
  }

  const move = (payoutId: string, target: PayoutState, detail: Record<string, string> = {}) =>
    unit((tx) => transitionPayout(tx, { payoutId, target, cause: "test", detail }));
  const view = async (headers: Record<string, string>, payoutId: string) => (await app.inject({ method: "GET", url: `/v1/payouts/${payoutId}`, headers })).json();

  it("says where a refunded payout stopped, how much came back and where to", async () => {
    const headers = await signIn("refund");
    const payout = await pay(headers);
    expect(await view(headers, payout.payout_id)).toMatchObject({ failure: null, refund: null, retry_of: null, retried_by: null, claim: null, settlement_name: null });

    await move(payout.payout_id, "paying_out");
    await move(payout.payout_id, "refunded", { refund_tx_hash: "0xrefund" });
    const refunded = await view(headers, payout.payout_id);
    expect(refunded.state).toBe("refunded");
    expect(refunded.failure).toMatchObject({ stage: "bank", code: null });
    expect(refunded.refund).toMatchObject({ amount: "50.00", to: "sender", tx: "0xrefund" });
    expect(new Date(refunded.refund.at).getTime()).toBeGreaterThanOrEqual(new Date(refunded.failure.at).getTime());
  });

  it("names the stage for a payout the provider never started, and for one never funded", async () => {
    const headers = await signIn("stages");
    const early = await pay(headers);
    await move(early.payout_id, "with_provider");
    await move(early.payout_id, "refunded");
    expect((await view(headers, early.payout_id)).failure.stage).toBe("provider");

    const unfunded = await pay(headers);
    await move(unfunded.payout_id, "expired");
    expect(await view(headers, unfunded.payout_id)).toMatchObject({ failure: { stage: "deposit" }, refund: null });
  });

  it("re-quotes without the provider that failed, and links the retry both ways", async () => {
    const headers = await signIn("retry");
    const failed = await pay(headers);
    await move(failed.payout_id, "paying_out");
    await move(failed.payout_id, "refunded");

    const reply = await app.inject({ method: "POST", url: `/v1/payouts/${failed.payout_id}/retry-quote`, headers });
    expect(reply.statusCode, reply.body).toBe(200);
    const quote = reply.json();
    expect(quote.provider).not.toBe(failed.provider);
    expect(quote.routes.map((route: { provider: string }) => route.provider)).not.toContain(failed.provider);
    expect(quote.amount).toBe("50.00");

    const retry = await app.inject({
      method: "POST",
      url: "/v1/payouts",
      payload: { quote_id: quote.quote_id, account: ACCOUNT, refund_address: "frank.fliq.near", retry_of: failed.payout_id },
      headers: { ...headers, "idempotency-key": key() },
    });
    expect(retry.statusCode, retry.body).toBe(201);
    expect(retry.json()).toMatchObject({ provider: quote.provider, retry_of: failed.payout_id });
    expect((await view(headers, failed.payout_id)).retried_by).toBe(retry.json().payout_id);
  });

  it("refuses to retry a payout that is still moving or that someone else owns", async () => {
    const headers = await signIn("noretry");
    const live = await pay(headers);
    expect((await app.inject({ method: "POST", url: `/v1/payouts/${live.payout_id}/retry-quote`, headers })).statusCode).toBe(409);
    const quote = (await app.inject({ method: "POST", url: "/v1/quotes", payload: { token: "usdc", currency: "ngn", amount: "50.00", source_chain: "base" }, headers })).json();
    const linked = await app.inject({
      method: "POST",
      url: "/v1/payouts",
      payload: { quote_id: quote.quote_id, account: ACCOUNT, refund_address: "frank.fliq.near", retry_of: live.payout_id },
      headers: { ...headers, "idempotency-key": key() },
    });
    expect(linked.statusCode).toBe(409);

    const stranger = await signIn("stranger");
    expect((await app.inject({ method: "POST", url: `/v1/payouts/${live.payout_id}/retry-quote`, headers: stranger })).statusCode).toBe(404);
  });

  it("opens one claim on a paid payout, tells support, and shows it on the payout", async () => {
    const headers = await signIn("claim");
    const payout = await pay(headers);
    const claim = (k: string) => app.inject({ method: "POST", url: `/v1/payouts/${payout.payout_id}/claims`, headers: { ...headers, "idempotency-key": k } });
    expect((await claim(key())).statusCode).toBe(409);

    await move(payout.payout_id, "settled", { fiat_reference: "000013251029140213" });
    const opened = await claim(key());
    expect(opened.statusCode, opened.body).toBe(201);
    const body = opened.json();
    expect(body).toMatchObject({ payout_id: payout.payout_id, state: "open", bank_reference: "000013251029140213" });
    const settledAt = new Date((await view(headers, payout.payout_id)).history.at(-1).at).getTime();
    expect(new Date(body.reversal_after).getTime() - settledAt).toBe(24 * 60 * 60_000);

    const again = await claim(key());
    expect(again.statusCode).toBe(200);
    expect(again.json().claim_id).toBe(body.claim_id);
    expect((await view(headers, payout.payout_id)).claim).toMatchObject({ claim_id: body.claim_id, state: "open" });

    const told = await unit((tx) => tx.outbox.findMany({ where: { routingKey: payout.payout_id, eventType: "payout.claim_opened" } }));
    expect(told).toHaveLength(1);
    expect(told[0]?.payload).toMatchObject({ claim_id: body.claim_id, bank_reference: "000013251029140213" });
  });
});
