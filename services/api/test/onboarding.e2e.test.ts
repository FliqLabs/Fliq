import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encrypt, keyedHash } from "../packages/db/src/crypto.js";
import { newId } from "../packages/db/src/ids.js";
import { MockProvisioner } from "../apps/api/src/accounts.js";
import { buildApp } from "../apps/api/src/app.js";
import type { EmailSender } from "../apps/api/src/auth/email-links.js";
import { loadConfig } from "../apps/api/src/config.js";
import { createDatabase, unitOf } from "../apps/api/src/db.js";
import { createHandlers } from "../apps/api/src/handlers.js";

// Only ever run against a throwaway local database: Prisma loads services/api/.env, which may point at a shared one.
const isLocalDatabase = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "");
const enabled = isLocalDatabase && Boolean(process.env.FLIQ_ACCESS_SECRET);

class CapturingSender implements EmailSender {
  links: string[] = [];
  async sendSignInLink(_to: string, link: string) {
    this.links.push(link);
  }
}

describe.skipIf(!enabled)("onboarding against a real database", () => {
  // vitest still runs the body of a skipped suite, so stop before anything needs real configuration.
  if (!enabled) {
    it("needs DATABASE_URL pointing at a local database", () => {});
    return;
  }

  const database = createDatabase();
  const sender = new CapturingSender();
  const config = loadConfig();
  const app = buildApp({
    config,
    unit: unitOf(database),
    logger: Boolean(process.env.E2E_LOG),
    handlers: createHandlers({ config, unit: unitOf(database), email: sender, provisioner: new MockProvisioner(config.vaultAccount) }),
  });
  const suffix = randomBytes(4).toString("hex");
  const email = `e2e+${suffix}@example.test`;
  const label = `e2e-${suffix}`;

  let access = "";
  let refresh = "";
  let userId = "";

  const call = (method: "GET" | "POST" | "PATCH", url: string, payload?: object, headers: Record<string, string> = {}) =>
    app.inject({ method, url: `/v1${url}`, payload, headers });
  const authed = (extra: Record<string, string> = {}) => ({ authorization: `Bearer ${access}`, ...extra });

  beforeAll(() => app.ready());

  afterAll(async () => {
    const user = await database.user.findUnique({ where: { email } });
    if (user) {
      const workspaces = await database.workspace.findMany({ where: { ownerId: user.id }, select: { id: true } });
      const ids = workspaces.map((w) => w.id);
      await database.payout.deleteMany({ where: { developerId: { in: ids } } });
      await database.recipient.deleteMany({ where: { userId: user.id } });
      await database.quote.deleteMany({ where: { developerId: { in: ids } } });
      await database.apiKey.deleteMany({ where: { workspaceId: { in: workspaces.map((w) => w.id) } } });
      await database.workspace.deleteMany({ where: { ownerId: user.id } });
      await database.idempotencyRecord.deleteMany({ where: { scope: user.id } });
      await database.session.deleteMany({ where: { userId: user.id } });
      await database.user.delete({ where: { id: user.id } });
    }
    await database.emailLink.deleteMany({ where: { email } });
    await database.$disconnect();
    await app.close();
  }, 60_000);

  it("rejects unknown fields and bad types with the shared error shape and a trace id", async () => {
    const extra = await call("POST", "/auth/email-links", { email, admin: true });
    expect(extra.statusCode).toBe(400);
    expect(extra.json().error.code).toBe("invalid_request");
    expect(extra.headers["x-trace-id"]).toBeTruthy();
    expect((await call("POST", "/auth/email-links", { email: 5 })).statusCode).toBe(400);
    expect((await call("POST", "/auth/email-links", { email: "not-an-email" })).statusCode).toBe(400);
  });

  it("emails a link, signs in once and refuses a replayed link", async () => {
    const sent = await call("POST", "/auth/email-links", { email });
    expect(sent.statusCode).toBe(202);
    expect(sent.json()).toEqual({ status: "sent" });
    const token = new URL(sender.links[0] as string).searchParams.get("token") as string;

    const session = await call("POST", "/auth/email-links/verify", { token });
    expect(session.statusCode).toBe(200);
    const body = session.json();
    expect(body.expires_in).toBe(900);
    expect(body.user).toMatchObject({ near_account: null, display_name: null, vault: null });
    access = body.access_token;
    refresh = body.refresh_token;
    userId = body.user.user_id;

    expect((await call("POST", "/auth/email-links/verify", { token })).statusCode).toBe(401);
  }, 60_000);

  it("protects /me and saves the profile", async () => {
    expect((await call("GET", "/me")).statusCode).toBe(401);
    expect((await call("GET", "/me", undefined, { authorization: "Bearer junk" })).statusCode).toBe(401);
    expect((await call("GET", "/me", undefined, authed())).json().user_id).toBe(userId);
    const updated = await call("PATCH", "/me", { display_name: "Frank", occupation: "Builder" }, authed());
    expect(updated.json()).toMatchObject({ display_name: "Frank", occupation: "Builder" });
  }, 60_000);

  it("checks names, then claims one idempotently", async () => {
    const free = await call("GET", `/names/${label}`, undefined, authed());
    expect(free.json()).toEqual({ name: `${label}.fliq.near`, available: true, reason: null });
    expect((await call("GET", "/names/admin", undefined, authed())).json().reason).toBe("reserved");
    expect((await call("GET", "/names/A_B", undefined, authed())).json().reason).toBe("invalid");

    const missing = await call("POST", "/me/name", { name: label }, authed());
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe("idempotency_key_required");

    const claimed = await call("POST", "/me/name", { name: label }, authed({ "idempotency-key": `claim-${suffix}` }));
    expect(claimed.statusCode).toBe(201);
    expect(claimed.json()).toMatchObject({ near_account: `${label}.fliq.near`, vault: "fliq-vault.testnet" });

    const replay = await call("POST", "/me/name", { name: label }, authed({ "idempotency-key": `claim-${suffix}` }));
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(claimed.json());

    const mismatch = await call("POST", "/me/name", { name: `${label}x` }, authed({ "idempotency-key": `claim-${suffix}` }));
    expect(mismatch.statusCode).toBe(422);
    expect(mismatch.json().error.code).toBe("idempotency_mismatch");

    const second = await call("POST", "/me/name", { name: `${label}y` }, authed({ "idempotency-key": `claim2-${suffix}` }));
    expect(second.statusCode).toBe(409);
    expect((await call("GET", `/names/${label}`, undefined, authed())).json().reason).toBe("taken");
  }, 120_000);

  it("creates a workspace and a one-time sandbox key, exactly once under 50 concurrent calls", async () => {
    const request = { name: "EntryPoint Labs", use_case: "wallet", countries: ["ng", "ke"] };
    const replies = await Promise.all(
      Array.from({ length: 50 }, () => call("POST", "/workspaces", request, authed({ "idempotency-key": `ws-${suffix}` }))),
    );
    expect(replies.every((reply) => reply.statusCode === 201)).toBe(true);
    const created = replies[0]?.json();
    for (const reply of replies) expect(reply.json()).toEqual(created);
    expect(created.workspace).toMatchObject({ name: "EntryPoint Labs", use_case: "wallet", countries: ["ng", "ke"] });
    expect(created.sandbox_key.key.startsWith("rt_test_")).toBe(true);
    expect(await database.workspace.count({ where: { ownerId: userId } })).toBe(1);
    expect(await database.apiKey.count({ where: { workspace: { ownerId: userId } } })).toBe(1);

    const stored = await database.apiKey.findFirstOrThrow({ where: { workspace: { ownerId: userId } } });
    expect(stored.keyHash).not.toContain(created.sandbox_key.key);
    expect(stored.last4).toBe(created.sandbox_key.key.slice(-4));
    const bad = await call("POST", "/workspaces", { ...request, use_case: "bank" }, authed({ "idempotency-key": `ws2-${suffix}` }));
    expect(bad.statusCode).toBe(400);
  }, 120_000);

  it("saves an https photo url and refuses anything else", async () => {
    const saved = await call("PATCH", "/me", { photo_url: "https://fliq-photos.s3.amazonaws.com/usr/frank.jpg" }, authed());
    expect(saved.statusCode).toBe(200);
    expect(saved.json().photo_url).toBe("https://fliq-photos.s3.amazonaws.com/usr/frank.jpg");
    expect((await call("PATCH", "/me", { photo_url: "http://example.com/a.jpg" }, authed())).statusCode).toBe(400);
    expect((await call("PATCH", "/me", { photo_url: "javascript:alert(1)" }, authed())).statusCode).toBe(400);
    expect((await call("PATCH", "/me", { photo_url: null }, authed())).json().photo_url).toBeNull();
  }, 60_000);

  it("serves the first-login dashboard, then pages real payouts", async () => {
    const workspace = (await call("GET", "/workspaces/current", undefined, authed())).json();
    expect(workspace).toMatchObject({ name: "EntryPoint Labs", countries: ["ng", "ke"], live_enabled: false });

    const keys = (await call("GET", "/keys", undefined, authed())).json();
    expect(keys.items).toHaveLength(1);
    expect(keys.items[0].masked).toMatch(/^rt_test_.{4}\.\.\..{4}$/);
    expect(keys.items[0].environment).toBe("test");

    const before = (await call("GET", "/onboarding", undefined, authed())).json();
    expect(before.steps).toEqual([
      { id: "create_test_payout", done: false },
      { id: "add_webhook", done: false },
      { id: "go_live", done: false },
    ]);
    expect((await call("GET", "/payouts", undefined, authed())).json()).toEqual({ items: [], next_cursor: null });

    const recipient = newId("rcp");
    const quote = newId("q");
    await database.$transaction(async (tx) => {
      await tx.recipient.create({
        data: {
          id: recipient,
          userId,
          institutionCode: "058",
          accountCipher: encrypt("0123456789", config.dataKey),
          nameCipher: encrypt("DARA OKONKWO", config.dataKey),
          lookupHash: keyedHash("058:0123456789", config.hashKey),
        },
      });
      await tx.quote.create({
        data: {
          id: quote,
          developerId: workspace.workspace_id,
          mode: "send_exactly",
          tokenSymbol: "USDC",
          sourceChain: "base",
          currency: "ngn",
          amountIn: 50_000_000n,
          amountOutMinor: 6_881_600n,
          rate: "1376.32",
          expiresAt: new Date(Date.now() + 90_000),
        },
      });
      for (let i = 0; i < 3; i++) {
        await tx.payout.create({
          data: {
            id: newId("po"),
            developerId: workspace.workspace_id,
            clientReference: `ref-${i}`,
            quoteId: quote,
            recipientId: recipient,
            routeKind: "direct",
            provider: "paycrest",
            state: "settled",
            amountIn: 50_000_000n,
            amountOutMinor: 6_881_600n,
            currency: "ngn",
            rate: "1376.32",
            createdAt: new Date(Date.UTC(2026, 9, 29, 13, 2, i)),
          },
        });
      }
    });

    const first = (await call("GET", "/payouts?limit=2", undefined, authed())).json();
    expect(first.items).toHaveLength(2);
    expect(first.next_cursor).toBeTruthy();
    expect(first.items[0]).toMatchObject({
      state: "settled",
      account_name: "DARA OKONKWO",
      bank: { code: "058", name: "GTBank" },
      account_last4: "6789",
      amount: "50.00",
      receive: 68816,
      currency: "ngn",
      provider: "paycrest",
    });
    expect(first.items[0].created_at > first.items[1].created_at).toBe(true);
    expect(JSON.stringify(first)).not.toContain("0123456789");

    const second = (await call("GET", `/payouts?limit=2&cursor=${first.next_cursor}`, undefined, authed())).json();
    expect(second.items).toHaveLength(1);
    expect(second.next_cursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((item) => item.payout_id)).size).toBe(3);

    expect((await call("GET", "/payouts?limit=0", undefined, authed())).statusCode).toBe(400);
    expect((await call("GET", "/payouts?cursor=garbage", undefined, authed())).statusCode).toBe(400);
    expect((await call("GET", "/onboarding", undefined, authed())).json().steps[0]).toEqual({ id: "create_test_payout", done: true });
  }, 120_000);

  it("rotates refresh tokens and revokes the family when an old one is reused", async () => {
    const rotated = await call("POST", "/auth/refresh", { refresh_token: refresh });
    expect(rotated.statusCode).toBe(200);
    const next = rotated.json();
    expect(next.refresh_token).not.toBe(refresh);
    expect((await call("GET", "/me", undefined, { authorization: `Bearer ${next.access_token}` })).statusCode).toBe(200);

    expect((await call("POST", "/auth/refresh", { refresh_token: refresh })).statusCode).toBe(401);
    expect((await call("GET", "/me", undefined, { authorization: `Bearer ${next.access_token}` })).statusCode).toBe(401);
    expect((await call("POST", "/auth/refresh", { refresh_token: next.refresh_token })).statusCode).toBe(401);
  }, 120_000);

  it("logs out by revoking the session", async () => {
    const link = await call("POST", "/auth/email-links", { email });
    expect(link.statusCode).toBe(202);
    const token = new URL(sender.links.at(-1) as string).searchParams.get("token") as string;
    const session = (await call("POST", "/auth/email-links/verify", { token })).json();
    const headers = { authorization: `Bearer ${session.access_token}` };
    expect((await call("GET", "/me", undefined, headers)).statusCode).toBe(200);
    expect((await call("POST", "/auth/logout", undefined, headers)).statusCode).toBe(204);
    expect((await call("GET", "/me", undefined, headers)).statusCode).toBe(401);
  }, 120_000);

  it("issues passkey options and refuses garbage credentials", async () => {
    for (const path of ["/auth/passkeys/register/options", "/auth/passkeys/login/options"]) {
      const reply = await call("POST", path);
      expect(reply.statusCode).toBe(200);
      expect(reply.json().challenge_id).toMatch(/^chl_/);
      expect(typeof reply.json().options.challenge).toBe("string");
    }
    const options = (await call("POST", "/auth/passkeys/register/options")).json();
    const garbage = await call("POST", "/auth/passkeys/register/verify", { challenge_id: options.challenge_id, credential: { id: "x" } });
    expect(garbage.statusCode).toBe(400);
    const reused = await call("POST", "/auth/passkeys/register/verify", { challenge_id: options.challenge_id, credential: { id: "x" } });
    expect(reused.statusCode).toBe(401);
  }, 120_000);
});
