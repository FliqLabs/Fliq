import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockProvisioner } from "../apps/api/src/accounts.js";
import { buildApp } from "../apps/api/src/app.js";
import type { EmailSender } from "../apps/api/src/auth/email-links.js";
import { loadConfig } from "../apps/api/src/config.js";
import { createDatabase, unitOf } from "../apps/api/src/db.js";
import { createHandlers } from "../apps/api/src/handlers.js";
import { recordObservedTransfer } from "../apps/api/src/people.js";
import { DEFAULT_VELOCITY } from "../apps/api/src/payouts.js";
import { sandboxAdapters } from "../apps/api/src/sandbox.js";
import { MockVault } from "../packages/chains/vault/index.js";
import { DEFAULT_ROUTING_CONFIG, NO_SIGNALS } from "../packages/domain/routing.js";
import { postEntry, vaultAvailable } from "../packages/ledger/post.js";
import { vaultCredited } from "../packages/ledger/postings.js";

// Throwaway local database only; Prisma loads .env, which may point at a shared one.
const enabled = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") && Boolean(process.env.FLIQ_ACCESS_SECRET);
const USDC = "usdc.test.near";
const NOW_NS = 1_000_000_000n;

describe.skipIf(!enabled)("vault balance and paying a fliq user", () => {
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
  const vault = new MockVault({ registrar: "registrar.test.near", usdc: USDC, now: () => NOW_NS });
  const adapters = sandboxAdapters();
  const app = buildApp({
    config,
    unit,
    handlers: createHandlers({
      config,
      unit,
      email: sender,
      provisioner: new MockProvisioner(config.vaultAccount, (account) => vault.registerStorage(account)),
      vault,
      quotes: { adapters, routing: DEFAULT_ROUTING_CONFIG, signals: NO_SIGNALS, now: () => new Date() },
      payouts: { config, adapters, velocity: DEFAULT_VELOCITY, now: () => new Date() },
    }),
  });
  const emails: string[] = [];
  const accounts: string[] = [];

  async function signUp(label: string, claim: boolean) {
    const email = `vault+${label}-${suffix}@example.test`;
    emails.push(email);
    await app.inject({ method: "POST", url: "/v1/auth/email-links", payload: { email } });
    const token = new URL(links.at(-1) as string).searchParams.get("token") as string;
    const session = (await app.inject({ method: "POST", url: "/v1/auth/email-links/verify", payload: { token } })).json();
    const headers = { authorization: `Bearer ${session.access_token}` };
    let account: string | null = null;
    if (claim) {
      const name = `${label}-${suffix}`;
      const claimed = await app.inject({ method: "POST", url: "/v1/me/name", payload: { name }, headers: { ...headers, "idempotency-key": `claim-${name}` } });
      account = claimed.json().near_account as string;
      accounts.push(account);
      await app.inject({ method: "PATCH", url: "/v1/me", payload: { display_name: label.toUpperCase() }, headers });
    }
    return { headers, account, userId: session.user.user_id as string };
  }

  const fundChain = (account: string, amount: bigint) => vault.ftOnTransfer({ predecessor: USDC, senderId: account, amount, msg: "" });
  const fundMirror = (account: string, amount: bigint, id: string) => unit((tx) => postEntry(tx, vaultCredited(id, account, "USDC", amount)));
  const balance = (headers: Record<string, string>) => app.inject({ method: "GET", url: "/v1/vault", headers });

  beforeAll(() => app.ready(), 60_000);

  afterAll(async () => {
    await database.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      const users = await tx.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
      const ids = users.map((user) => user.id);
      await tx.$executeRaw`DELETE FROM ledger.journal_lines WHERE entry_id IN (SELECT id FROM ledger.journal_entries WHERE payout_id LIKE ${`%${suffix}%`} OR payout_id IN (SELECT id FROM core.transfers WHERE from_user_id = ANY(${ids}::text[])))`;
      await tx.$executeRaw`DELETE FROM ledger.journal_entries WHERE payout_id LIKE ${`%${suffix}%`} OR payout_id IN (SELECT id FROM core.transfers WHERE from_user_id = ANY(${ids}::text[]))`;
      await tx.$executeRaw`DELETE FROM ledger.balances WHERE account_id IN (SELECT id FROM ledger.accounts WHERE code LIKE ${`%${suffix}%`})`;
      await tx.$executeRaw`DELETE FROM ledger.accounts WHERE code LIKE ${`%${suffix}%`}`;
      await tx.$executeRaw`DELETE FROM core.transfers WHERE from_user_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM developer.idempotency_records WHERE scope = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.sessions WHERE user_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.users WHERE id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.email_links WHERE email = ANY(${emails}::text[])`;
    });
    await database.$disconnect();
  }, 60_000);

  it("has no vault until a name is claimed, then reports free, reserved and whether the ledger agrees", async () => {
    const early = await signUp("early", false);
    expect((await balance(early.headers)).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/v1/vault" })).statusCode).toBe(401);

    const frank = await signUp("frank", true);
    expect((await balance(frank.headers)).json()).toEqual({ account: frank.account, available: "0.00", reserved: "0.00", total: "0.00", in_sync: true });

    fundChain(frank.account as string, 128_180_000n);
    await fundMirror(frank.account as string, 128_180_000n, `topup-${suffix}`);
    expect((await balance(frank.headers)).json()).toMatchObject({ available: "128.18", reserved: "0.00", total: "128.18", in_sync: true });

    fundChain(frank.account as string, 1_000_000n);
    expect((await balance(frank.headers)).json()).toMatchObject({ available: "129.18", in_sync: false });

    await fundMirror(frank.account as string, 1_000_000n, `topup2-${suffix}`);
    await vault.registerOrder({ orderId: `po-${suffix}`, payer: frank.account as string, depositAddress: "dep.near", amount: 50_000_000n, expiresAtNs: NOW_NS + 600_000_000_000n, corridor: "NG-NGN-bank" });
    expect((await balance(frank.headers)).json()).toMatchObject({ available: "79.18", reserved: "50.00", total: "129.18", in_sync: false });
  }, 120_000);

  it("finds a person by name, bare or full, and only for signed-in users", async () => {
    const tobi = await signUp("tobi", true);
    for (const name of [`tobi-${suffix}`, tobi.account as string, (tobi.account as string).toUpperCase()]) {
      const reply = await app.inject({ method: "GET", url: `/v1/people/${name}`, headers: tobi.headers });
      expect(reply.statusCode, name).toBe(200);
      expect(reply.json()).toMatchObject({ near_account: tobi.account, display_name: "TOBI", photo_url: null });
      expect(reply.json().member_since).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    expect((await app.inject({ method: "GET", url: "/v1/people/nobody-here", headers: tobi.headers })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/people/tobi-${suffix}` })).statusCode).toBe(401);
  }, 60_000);

  it("records a transfer the chain confirmed, mirrors it in the ledger and ignores a replay", async () => {
    const ada = await signUp("ada", true);
    const bob = await signUp("bob", true);
    await fundMirror(ada.account as string, 100_000_000n, `adafund-${suffix}`);
    const hash = `tx-${suffix}-1`;

    const first = await unit((tx) => recordObservedTransfer(tx, { txHash: hash, from: ada.account as string, to: bob.account as string, amount: 25_000_000n }));
    expect(first.status).toBe("recorded");
    expect(await unit((tx) => vaultAvailable(tx, ada.account as string, "USDC"))).toBe(75_000_000n);
    expect(await unit((tx) => vaultAvailable(tx, bob.account as string, "USDC"))).toBe(25_000_000n);

    const replay = await unit((tx) => recordObservedTransfer(tx, { txHash: hash, from: ada.account as string, to: bob.account as string, amount: 25_000_000n }));
    expect(replay).toEqual({ status: "already_recorded", transferId: (first as { transferId: string }).transferId });
    expect(await unit((tx) => vaultAvailable(tx, ada.account as string, "USDC"))).toBe(75_000_000n);

    const racing = await Promise.all(
      Array.from({ length: 20 }, () => unit((tx) => recordObservedTransfer(tx, { txHash: `tx-${suffix}-2`, from: ada.account as string, to: bob.account as string, amount: 5_000_000n }))),
    );
    expect(racing.filter((outcome) => outcome.status === "recorded")).toHaveLength(1);
    expect(await unit((tx) => vaultAvailable(tx, bob.account as string, "USDC"))).toBe(30_000_000n);

    const stranger = await unit((tx) => recordObservedTransfer(tx, { txHash: `tx-${suffix}-3`, from: ada.account as string, to: "someone.else.near", amount: 1n }));
    expect(stranger).toEqual({ status: "unknown_account" });
    expect(await database.transfer.count({ where: { txHash: `tx-${suffix}-3` } })).toBe(0);

    const recent = (await app.inject({ method: "GET", url: "/v1/people/recent", headers: ada.headers })).json();
    expect(recent.items).toHaveLength(1);
    expect(recent.items[0]).toMatchObject({ near_account: bob.account, display_name: "BOB" });
    expect((await app.inject({ method: "GET", url: "/v1/people/recent", headers: bob.headers })).json().items).toEqual([]);
  }, 120_000);
});
