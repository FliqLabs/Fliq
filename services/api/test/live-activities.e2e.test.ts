import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockProvisioner } from "../apps/api/src/accounts.js";
import { buildApp } from "../apps/api/src/app.js";
import type { EmailSender } from "../apps/api/src/auth/email-links.js";
import { loadConfig } from "../apps/api/src/config.js";
import { createDatabase, unitOf } from "../apps/api/src/db.js";
import { createHandlers } from "../apps/api/src/handlers.js";
import { dispatchLiveActivities } from "../apps/api/src/live-activities.js";
import type { PushTarget } from "../apps/api/src/push.js";
import { MockVault } from "../packages/chains/vault/index.js";

// Throwaway local database only; Prisma loads .env, which may point at a shared one.
const enabled = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") && Boolean(process.env.FLIQ_ACCESS_SECRET);

describe.skipIf(!enabled)("Live Activities", () => {
  if (!enabled) {
    it("needs DATABASE_URL pointing at a local database", () => {});
    return;
  }

  const database = createDatabase();
  const unit = unitOf(database);
  const config = loadConfig();
  const links: string[] = [];
  const sender: EmailSender = { sendSignInLink: async (_to, link) => void links.push(link) };
  const suffix = randomBytes(3).toString("hex");
  const emails: string[] = [];
  const vault = new MockVault({ registrar: "registrar.test.near", usdc: "usdc.test.near", now: () => BigInt(Date.now()) * 1_000_000n });
  const notUsed = async () => {
    throw new Error("not used");
  };
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    app = buildApp({
      config,
      unit,
      logger: false,
      handlers: createHandlers({
        config,
        unit,
        email: sender,
        provisioner: new MockProvisioner(config.vaultAccount, (account) => vault.registerStorage(account)),
        relayer: { relay: notUsed, relayStatus: notUsed, health: async () => ({ status: "ok" }), provisionAccount: notUsed, fundAgentDeposit: notUsed },
        vault,
      } as unknown as Parameters<typeof createHandlers>[0]),
    });
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    const users = await database.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
    const ids = users.map((user) => user.id);
    await database.liveActivity.deleteMany({ where: { userId: { in: ids } } });
    await database.payout.deleteMany({ where: { developerId: { in: ids } } });
    await database.quote.deleteMany({ where: { developerId: { in: ids } } });
    await database.recipient.deleteMany({ where: { userId: { in: ids } } });
    await database.vaultDeposit.deleteMany({ where: { userId: { in: ids } } });
    await database.session.deleteMany({ where: { userId: { in: ids } } });
    await database.$executeRaw`DELETE FROM auth.session_devices WHERE user_id = ANY(${ids}::text[])`;
    await database.user.deleteMany({ where: { id: { in: ids } } });
    await database.emailLink.deleteMany({ where: { email: { in: emails } } });
    await database.$disconnect();
  }, 60_000);

  async function holder(label: string) {
    const email = `live+${label}-${suffix}@example.test`;
    emails.push(email);
    await app.inject({ method: "POST", url: "/v1/auth/email-links", payload: { email } });
    const token = new URL(links.at(-1) as string).searchParams.get("token") as string;
    const session = (await app.inject({ method: "POST", url: "/v1/auth/email-links/verify", payload: { token } })).json();
    const headers = { authorization: `Bearer ${session.access_token}` };
    const userId = (await app.inject({ method: "GET", url: "/v1/me", headers })).json().user_id as string;
    return { headers, userId };
  }

  const createDeposit = (id: string, userId: string) =>
    unit((tx) =>
      tx.vaultDeposit.create({
        data: {
          id,
          userId,
          account: `${id}.fliqaccount.testnet`,
          token: "usdc",
          chain: "solana",
          decimals: 6,
          depositAddress: `addr-${id}`,
          amountUnits: 20_000_000n,
          minimumUnits: 19_000_000n,
          feeMicroUsd: 0n,
          landsUnits: 20_000_000n,
          etaSeconds: 60,
          reservedUntil: new Date(Date.now() + 3_600_000),
          quote: {},
        },
      }),
    );

  const register = (headers: Record<string, string>, token: string, kind: string, ref: string) =>
    app.inject({
      method: "POST",
      url: "/v1/live-activities",
      headers,
      payload: { token, kind, ref_id: ref, environment: "sandbox", bundle_id: "cash.fliq.app" },
    });

  it("follows the caller's own deposit, refuses anyone else's, and pushes each change once until it ends", async () => {
    const frank = await holder("frank");
    const tobi = await holder("tobi");
    const depositId = `dep_live_${suffix}`;
    await createDeposit(depositId, frank.userId);

    const token = `AB${randomBytes(20).toString("hex")}`;
    expect((await register(tobi.headers, `cd${randomBytes(20).toString("hex")}`, "deposit", depositId)).statusCode).toBe(404);
    expect((await register(frank.headers, token, "payout", `po_missing_${suffix}`)).statusCode).toBe(404);
    expect((await register(frank.headers, "not-hex", "deposit", depositId)).statusCode).toBe(400);
    expect((await register(frank.headers, token, "deposit", depositId)).statusCode).toBe(204);

    const sent: { target: PushTarget; payload: { aps: Record<string, unknown> } }[] = [];
    const send = async (target: PushTarget, payload: object) => {
      if (target.token === token.toLowerCase()) sent.push({ target, payload: payload as { aps: Record<string, unknown> } });
      return { status: 200 };
    };
    const dispatch = () => dispatchLiveActivities({ unit, send, now: () => new Date(), log: () => {} });
    const moveTo = (data: object) => unit((tx) => tx.vaultDeposit.update({ where: { id: depositId }, data }));

    await dispatch();
    await dispatch();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.target).toMatchObject({ environment: "sandbox", bundleId: "cash.fliq.app", pushType: "liveactivity" });
    expect(sent[0]?.payload.aps).toMatchObject({ event: "update", "content-state": { step: 0, status: "Waiting for it" } });

    await moveTo({ state: "seen", seenAt: new Date() });
    await dispatch();
    await moveTo({ state: "bridging", bridgingAt: new Date() });
    await dispatch();
    await dispatch();
    expect(sent.map((item) => item.payload.aps["content-state"])).toMatchObject([{ step: 0 }, { step: 1, status: "Seen on Solana" }, { step: 2 }]);

    await moveTo({ state: "landed", landedAt: new Date() });
    await dispatch();
    await dispatch();
    expect(sent).toHaveLength(4);
    const end = sent[3]?.payload.aps as Record<string, number | string | object>;
    expect(end).toMatchObject({ event: "end", "content-state": { step: 3, steps: 3, status: "In your vault", done: true, failed: false } });
    expect(end["dismissal-date"]).toBe((end.timestamp as number) + 15 * 60);
    const row = await unit((tx) => tx.liveActivity.findUniqueOrThrow({ where: { token: token.toLowerCase() } }));
    expect(row.endedAt).not.toBeNull();
  });

  it("follows the caller's own cash-out to the bank and keeps a refund open until it is back", async () => {
    const kemi = await holder("kemi");
    const stranger = await holder("stranger");
    const payoutId = `po_live_${suffix}`;
    await unit(async (tx) => {
      await tx.recipient.create({
        data: { id: `rcp_live_${suffix}`, userId: kemi.userId, institutionCode: "058", accountCipher: Buffer.from("a"), nameCipher: Buffer.from("n"), lookupHash: Buffer.from(`live-${suffix}`) },
      });
      await tx.quote.create({
        data: { id: `quo_live_${suffix}`, developerId: kemi.userId, mode: "send_exactly", tokenSymbol: "usdc", sourceChain: "near", currency: "ngn", amountIn: 10_070_000n, amountOutMinor: 1_388_200n, rate: "1388.2", expiresAt: new Date(Date.now() + 60_000) },
      });
      await tx.payout.create({
        data: { id: payoutId, developerId: kemi.userId, clientReference: `live-${suffix}`, quoteId: `quo_live_${suffix}`, recipientId: `rcp_live_${suffix}`, routeKind: "direct", provider: "mock", amountIn: 10_070_000n, amountOutMinor: 1_388_200n, currency: "ngn", rate: "1388.2" },
      });
    });
    const token = randomBytes(20).toString("hex");
    expect((await register(stranger.headers, token, "payout", payoutId)).statusCode).toBe(404);
    expect((await register(kemi.headers, token, "payout", payoutId)).statusCode).toBe(204);

    const sent: { aps: Record<string, unknown> }[] = [];
    const dispatch = () =>
      dispatchLiveActivities({
        unit,
        send: async (target, payload) => {
          if (target.token === token) sent.push(payload as { aps: Record<string, unknown> });
          return { status: 200 };
        },
        now: () => new Date(),
        log: () => {},
      });
    const moveTo = (state: "paying_out" | "refunding" | "refunded") => unit((tx) => tx.payout.update({ where: { id: payoutId }, data: { state } }));

    await dispatch();
    await moveTo("paying_out");
    await dispatch();
    await moveTo("refunding");
    await dispatch();
    await moveTo("refunded");
    await dispatch();
    await dispatch();
    expect(sent.map((item) => [item.aps.event, (item.aps["content-state"] as { status: string }).status])).toEqual([
      ["update", "Sending"],
      ["update", "The bank is paying"],
      ["update", "Refunding"],
      ["end", "Refunded to your vault"],
    ]);
  });

  it("forgets an activity whose token Apple says is gone", async () => {
    const ada = await holder("ada");
    const depositId = `dep_dead_${suffix}`;
    await createDeposit(depositId, ada.userId);
    const token = randomBytes(20).toString("hex");
    expect((await register(ada.headers, token, "deposit", depositId)).statusCode).toBe(204);
    await dispatchLiveActivities({
      unit,
      send: async (target) => (target.token === token ? { status: 410, reason: "Unregistered" } : { status: 200 }),
      now: () => new Date(),
      log: () => {},
    });
    expect(await unit((tx) => tx.liveActivity.findUnique({ where: { token } }))).toBeNull();
  });
});
