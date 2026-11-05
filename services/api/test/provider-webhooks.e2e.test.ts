import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockVault } from "../packages/chains/vault/index.js";
import { MockProvisioner } from "../apps/api/src/accounts.js";
import { buildApp } from "../apps/api/src/app.js";
import type { EmailSender } from "../apps/api/src/auth/email-links.js";
import { loadConfig } from "../apps/api/src/config.js";
import { createDatabase, unitOf } from "../apps/api/src/db.js";
import { createHandlers } from "../apps/api/src/handlers.js";
import { DEFAULT_VELOCITY } from "../apps/api/src/payouts.js";
import { receiveProviderWebhook } from "../apps/api/src/provider-hooks.js";
import { sandboxAdapters } from "../apps/api/src/sandbox.js";
import { DEFAULT_ROUTING_CONFIG, NO_SIGNALS } from "../packages/domain/routing.js";
import { MOCK_SIGNATURE_HEADER } from "../packages/providers/mock/mock.js";
import { hmac } from "../packages/webhooks/hmac.js";

// Throwaway local database only; Prisma loads .env, which may point at a shared one.
const enabled =
  /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") &&
  Boolean(process.env.FLIQ_ACCESS_SECRET);

const NOW = new Date("2026-11-05T10:00:00Z");
const ACCOUNT = { bank: "058", number: "0123456789" };
const SECRET = process.env.MOCK_WEBHOOK_SECRET ?? "sandbox";

describe.skipIf(!enabled)("provider webhooks against a real database", () => {
  if (!enabled) {
    it("needs DATABASE_URL pointing at a local database", () => {});
    return;
  }

  const database = createDatabase();
  const config = loadConfig();
  const unit = unitOf(database);
  const adapters = sandboxAdapters(() => NOW);
  const links: string[] = [];
  const sender: EmailSender = { sendSignInLink: async (_to, link) => void links.push(link) };
  const suffix = randomBytes(4).toString("hex");
  const emails: string[] = [];

  const app = buildApp({
    config,
    unit,
    handlers: createHandlers({
      config,
      unit,
      email: sender,
      provisioner: new MockProvisioner(config.vaultAccount),
      vault: new MockVault({ registrar: "registrar.test.near", usdc: "usdc.test.near", now: () => 0n }),
      quotes: { adapters, routing: DEFAULT_ROUTING_CONFIG, signals: NO_SIGNALS, now: () => NOW },
      payouts: { config, adapters, velocity: DEFAULT_VELOCITY, now: () => NOW },
    }),
    providerHook: (provider, headers, rawBody) =>
      receiveProviderWebhook({ config, unit, adapters }, provider, headers, rawBody),
  });

  let access = "";
  let userId = "";
  let eventCounter = 0;

  async function signIn() {
    const email = `hooks-${suffix}@example.test`;
    emails.push(email);
    await app.inject({ method: "POST", url: "/v1/auth/email-links", payload: { email } });
    const token = new URL(links.at(-1) as string).searchParams.get("token") as string;
    const session = (
      await app.inject({ method: "POST", url: "/v1/auth/email-links/verify", payload: { token } })
    ).json();
    access = session.access_token as string;
    userId = session.user.user_id as string;
  }

  async function newPayout() {
    const quoted = await app.inject({
      method: "POST",
      url: "/v1/quotes",
      payload: { token: "usdc", currency: "ngn", amount: "50.00", source_chain: "base" },
      headers: { authorization: `Bearer ${access}` },
    });
    const reply = await app.inject({
      method: "POST",
      url: "/v1/payouts",
      payload: { quote_id: quoted.json().quote_id, account: ACCOUNT, refund_address: "ada.fliq.near" },
      headers: {
        authorization: `Bearer ${access}`,
        "idempotency-key": `hooks-${suffix}-${randomBytes(4).toString("hex")}`,
      },
    });
    expect(reply.statusCode).toBe(201);
    const payout = reply.json();
    return { id: payout.payout_id as string, order: payout.provider_order as string };
  }

  // Pretty-printed on purpose: the signature covers these exact bytes, so re-serialising the body would break it.
  function signed(payload: Record<string, string>, secret = SECRET) {
    const rawBody = JSON.stringify(payload, null, 2);
    return { rawBody, signature: hmac("sha256", secret, rawBody, "hex") };
  }

  function event(payout: { id: string; order: string }, status: string, extra: Record<string, string> = {}) {
    eventCounter += 1;
    return {
      event_id: `${suffix}-${eventCounter}`,
      order_id: payout.order,
      reference: payout.id,
      status,
      ...extra,
    };
  }

  const post = (body: { rawBody: string; signature: string }, provider = "mock") =>
    app.inject({
      method: "POST",
      url: `/hooks/${provider}`,
      payload: body.rawBody,
      headers: { "content-type": "application/json", [MOCK_SIGNATURE_HEADER]: body.signature },
    });

  const view = async (payoutId: string) =>
    (
      await app.inject({
        method: "GET",
        url: `/v1/payouts/${payoutId}`,
        headers: { authorization: `Bearer ${access}` },
      })
    ).json();

  beforeAll(async () => {
    await app.ready();
    await signIn();
  }, 60_000);

  afterAll(async () => {
    await database.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      const payouts = await tx.payout.findMany({ where: { developerId: userId }, select: { id: true } });
      const ids = payouts.map((payout) => payout.id);
      await tx.$executeRaw`DELETE FROM integration.inbound_events WHERE payout_id = ANY(${ids}::text[]) OR provider_event_id LIKE ${`${suffix}-%`} OR (provider_event_id IS NULL AND received_at >= ${NOW})`;
      await tx.$executeRaw`DELETE FROM ledger.journal_lines WHERE entry_id IN (SELECT id FROM ledger.journal_entries WHERE payout_id = ANY(${ids}::text[]))`;
      await tx.$executeRaw`DELETE FROM ledger.journal_entries WHERE payout_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM core.payout_events WHERE payout_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM core.payouts WHERE id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM core.recipients WHERE user_id = ${userId}`;
      await tx.$executeRaw`DELETE FROM core.quote_routes WHERE quote_id IN (SELECT id FROM core.quotes WHERE developer_id = ${userId})`;
      await tx.$executeRaw`DELETE FROM core.quotes WHERE developer_id = ${userId}`;
      await tx.$executeRaw`DELETE FROM developer.idempotency_records WHERE scope = ${userId}`;
      await tx.$executeRaw`DELETE FROM auth.sessions WHERE user_id = ${userId}`;
      await tx.$executeRaw`DELETE FROM auth.users WHERE id = ${userId}`;
      await tx.$executeRaw`DELETE FROM auth.email_links WHERE email = ANY(${emails}::text[])`;
    });
    await database.$disconnect();
  }, 60_000);

  it("settles a payout from a signed paid webhook and shows the bank reference", async () => {
    const payout = await newPayout();
    const reply = await post(signed(event(payout, "paid", { fiat_reference: "NIP-000123" })));
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toEqual({ received: true, outcome: "processed" });

    const after = await view(payout.id);
    expect(after.state).toBe("settled");
    expect(after.bank_reference).toBe("NIP-000123");
    expect(after.history.map((entry: { state: string }) => entry.state)).toEqual([
      "created",
      "awaiting_deposit",
      "deposit_seen",
      "with_provider",
      "paying_out",
      "settled",
    ]);

    const stored = await database.inboundEvent.findFirstOrThrow({ where: { payoutId: payout.id } });
    expect(stored).toMatchObject({ provider: "mock", signatureValid: true, providerOrderId: payout.order });
    expect(stored.processedAt).not.toBeNull();
    expect(Buffer.from(stored.bodyCipher).toString("utf8")).not.toContain("NIP-000123");
  }, 60_000);

  it("ignores the same event twice and a late signal after settlement", async () => {
    const payout = await newPayout();
    const paid = signed(event(payout, "paid"));
    expect((await post(paid)).json().outcome).toBe("processed");
    expect((await post(paid)).json()).toEqual({ received: true, outcome: "duplicate" });

    expect((await post(signed(event(payout, "processing")))).json().outcome).toBe("processed");
    const after = await view(payout.id);
    expect(after.state).toBe("settled");
    expect(await database.inboundEvent.count({ where: { payoutId: payout.id } })).toBe(2);
  }, 60_000);

  it("walks an out-of-order refund to failed and records the provider's reason", async () => {
    const payout = await newPayout();
    expect((await post(signed(event(payout, "refunding")))).json().outcome).toBe("processed");
    expect(
      (await post(signed(event(payout, "failed", { failure_code: "account_closed" })))).json().outcome,
    ).toBe("processed");
    expect((await view(payout.id)).state).toBe("failed");
    const row = await database.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(row.failureReason).toBe("provider_account_closed");
  }, 60_000);

  it("stores but does not apply a move the state machine refuses", async () => {
    const payout = await newPayout();
    const reply = await post(signed(event(payout, "failed", { failure_code: "account_closed" })));
    expect(reply.json()).toEqual({ received: true, outcome: "not_applied" });
    expect((await view(payout.id)).state).toBe("awaiting_deposit");
    const stored = await database.inboundEvent.findFirstOrThrow({ where: { payoutId: payout.id } });
    expect(stored.processedAt).toBeNull();
  }, 60_000);

  it("rejects a bad signature, keeps it for audit and leaves the payout alone", async () => {
    const payout = await newPayout();
    const forged = signed(event(payout, "paid"), "not-the-secret");
    const reply = await post(forged);
    expect(reply.statusCode).toBe(401);
    expect(reply.json().error.code).toBe("invalid_signature");
    expect((await view(payout.id)).state).toBe("awaiting_deposit");
    const flagged = await database.inboundEvent.findFirst({
      where: { provider: "mock", signatureValid: false, receivedAt: { gte: NOW } },
      orderBy: { receivedAt: "desc" },
    });
    expect(flagged).toMatchObject({ providerEventId: null, payoutId: null, processedAt: null });
  }, 60_000);

  it("stores an event for a payout we do not know without touching anything", async () => {
    const reply = await post(
      signed(event({ id: `po_unknown_${suffix}`, order: `mo_unknown_${suffix}` }, "paid")),
    );
    expect(reply.json()).toEqual({ received: true, outcome: "unknown_payout" });
    const stored = await database.inboundEvent.findFirstOrThrow({
      where: { providerEventId: `${suffix}-${eventCounter}` },
    });
    expect(stored).toMatchObject({ payoutId: null, processedAt: null });
  }, 60_000);

  it("answers 404 for a provider that is not enabled", async () => {
    const payout = await newPayout();
    const reply = await post(signed(event(payout, "paid")), "paycrest");
    expect(reply.statusCode).toBe(404);
    expect((await view(payout.id)).state).toBe("awaiting_deposit");
  }, 60_000);
});
