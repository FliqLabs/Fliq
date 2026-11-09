import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockProvisioner } from "../apps/api/src/accounts.js";
import { buildApp } from "../apps/api/src/app.js";
import type { EmailSender } from "../apps/api/src/auth/email-links.js";
import { loadConfig } from "../apps/api/src/config.js";
import { createDatabase, unitOf } from "../apps/api/src/db.js";
import { createDeposits } from "../apps/api/src/deposits.js";
import { createHandlers } from "../apps/api/src/handlers.js";
import { DEFAULT_VELOCITY } from "../apps/api/src/payouts.js";
import { sandboxAdapters } from "../apps/api/src/sandbox.js";
import { createOneClickClient, createOneClickMock } from "../packages/chains/oneclick/index.js";
import { MockVault } from "../packages/chains/vault/index.js";
import { DEFAULT_ROUTING_CONFIG, NO_SIGNALS } from "../packages/domain/routing.js";
import { vaultMirror } from "../packages/ledger/post.js";

// Throwaway local database only; Prisma loads .env, which may point at a shared one.
const enabled = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") && Boolean(process.env.FLIQ_ACCESS_SECRET);
const USDC = "usdc.test.near";

describe.skipIf(!enabled)("topping up the vault from another chain", () => {
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
  // One clock for the API and the 1Click mock, so a test can step past an address's deadline.
  const clock = { offsetMs: 0 };
  const now = () => new Date(Date.now() + clock.offsetMs);
  const vault = new MockVault({ registrar: "registrar.test.near", usdc: USDC, now: () => BigInt(now().getTime()) * 1_000_000n });

  let server: Server;
  let mockUrl: string;
  let app: ReturnType<typeof buildApp>;
  let deposits: ReturnType<typeof createDeposits>;

  beforeAll(async () => {
    const mock = createOneClickMock({ now, processingAfterMs: 200, settleAfterMs: 600 });
    server = createServer((req, res) => void mock.handle(req, res));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    mockUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    deposits = createDeposits({
      client: createOneClickClient({ baseUrl: mockUrl, apiKey: undefined }),
      vaultAccount: config.vaultAccount,
      usdcContract: USDC,
      slippageBps: 200,
      now,
      onLanded: ({ units, message }) => void vault.ftOnTransfer({ predecessor: USDC, senderId: "intents.near", amount: units, msg: message }),
    });
    const adapters = sandboxAdapters();
    app = buildApp({
      config,
      unit,
      logger: Boolean(process.env.E2E_LOG),
      handlers: createHandlers({
        config,
        unit,
        email: sender,
        provisioner: new MockProvisioner(config.vaultAccount, (account) => vault.registerStorage(account)),
        vault,
        deposits,
        quotes: { adapters, routing: DEFAULT_ROUTING_CONFIG, signals: NO_SIGNALS, now },
        payouts: { config, adapters, velocity: DEFAULT_VELOCITY, now },
      }),
    });
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    server.close();
    await database.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      const users = await tx.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
      const ids = users.map((user) => user.id);
      await tx.$executeRaw`DELETE FROM ledger.journal_lines WHERE entry_id IN (SELECT e.id FROM ledger.journal_entries e JOIN core.vault_deposits d ON d.id = e.payout_id WHERE d.user_id = ANY(${ids}::text[]))`;
      await tx.$executeRaw`DELETE FROM ledger.journal_entries WHERE payout_id IN (SELECT id FROM core.vault_deposits WHERE user_id = ANY(${ids}::text[]))`;
      await tx.$executeRaw`DELETE FROM ledger.balances WHERE account_id IN (SELECT id FROM ledger.accounts WHERE code LIKE ${`%${suffix}%`})`;
      await tx.$executeRaw`DELETE FROM ledger.accounts WHERE code LIKE ${`%${suffix}%`}`;
      await tx.$executeRaw`DELETE FROM core.vault_deposits WHERE user_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM developer.idempotency_records WHERE scope = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.sessions WHERE user_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.users WHERE id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.email_links WHERE email = ANY(${emails}::text[])`;
    });
    await database.$disconnect();
  }, 60_000);

  async function holder(label: string, claim = true) {
    const email = `deposits+${label}-${suffix}@example.test`;
    emails.push(email);
    await app.inject({ method: "POST", url: "/v1/auth/email-links", payload: { email } });
    const token = new URL(links.at(-1) as string).searchParams.get("token") as string;
    const session = (await app.inject({ method: "POST", url: "/v1/auth/email-links/verify", payload: { token } })).json();
    const headers = { authorization: `Bearer ${session.access_token}` };
    let account = "";
    if (claim) {
      const name = `${label}-${suffix}`;
      account = (await app.inject({ method: "POST", url: "/v1/me/name", payload: { name }, headers: { ...headers, "idempotency-key": `claim-${name}` } })).json().near_account;
    }
    return { headers, account };
  }

  const reserve = (headers: Record<string, string>, key: string, payload: Record<string, string>) =>
    app.inject({ method: "POST", url: "/v1/deposits", payload, headers: { ...headers, "idempotency-key": key } });
  const read = (headers: Record<string, string>, id: string) => app.inject({ method: "GET", url: `/v1/deposits/${id}`, headers });
  const send = (address: string, amount: bigint) =>
    fetch(`${mockUrl}/mock/deposit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ depositAddress: address, amount: amount.toString() }) });
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function pollUntil(headers: Record<string, string>, id: string, state: string) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const view = (await read(headers, id)).json();
      if (view.state === state) return view;
      await pause(3_100);
    }
    throw new Error(`deposit ${id} never reached ${state}`);
  }

  it("lists every source, the NEAR one with the user's own account and the ones 1Click lacks as unavailable", async () => {
    const user = await holder("sources");
    const reply = await app.inject({ method: "GET", url: "/v1/deposits/sources", headers: user.headers });
    expect(reply.statusCode, reply.body).toBe(200);
    const { sources } = reply.json();
    expect(sources.map((s: { chain: string }) => s.chain)).toEqual(["base", "solana", "tron", "arbitrum", "ethereum", "polygon", "bitcoin", "near"]);
    expect(sources.find((s: { chain: string }) => s.chain === "near")).toMatchObject({ direct: true, available: true, address: user.account });
    expect(sources.find((s: { chain: string }) => s.chain === "bitcoin")).toMatchObject({ available: false, address: null });
    expect(sources.find((s: { chain: string }) => s.chain === "tron")).toMatchObject({ minimum: "100.00", available: true });
  });

  it("estimates what about 200 USDC from Solana lands as, without reserving anything", async () => {
    const user = await holder("estimate");
    const reply = await app.inject({ method: "GET", url: "/v1/deposits/estimate?token=usdc&chain=solana&amount=200.00", headers: user.headers });
    expect(reply.statusCode, reply.body).toBe(200);
    expect(reply.json()).toMatchObject({ amount: "200.00", minimum: "196.00", fee: "0.20", lands: "199.800199" });
  });

  it("refuses what it cannot reserve: no vault yet, NEAR itself, under the minimum, an unknown source", async () => {
    const unclaimed = await holder("unclaimed", false);
    expect((await reserve(unclaimed.headers, `u-${suffix}`, { token: "usdc", chain: "solana", amount: "200" })).statusCode).toBe(404);
    const user = await holder("refuse");
    const near = await reserve(user.headers, `n-${suffix}`, { token: "usdc", chain: "near", amount: "5" });
    expect(near.statusCode).toBe(400);
    expect(near.json().error.message).toContain(user.account);
    const tron = await reserve(user.headers, `t-${suffix}`, { token: "usdt", chain: "tron", amount: "50" });
    expect(tron.statusCode).toBe(400);
    expect(tron.json().error.message).toContain("100.00 USDT");
    expect((await reserve(user.headers, `b-${suffix}`, { token: "usdc", chain: "bitcoin", amount: "5" })).statusCode).toBe(400);
  });

  it("reserves one address per key, follows it from seen to landed and credits the vault and its mirror", async () => {
    const user = await holder("happy");
    const created = await reserve(user.headers, `h-${suffix}`, { token: "usdc", chain: "solana", amount: "200.00" });
    expect(created.statusCode, created.body).toBe(201);
    const deposit = created.json();
    expect(deposit).toMatchObject({ state: "waiting", token: "usdc", chain: "solana", amount: "200.00", minimum: "196.00", received: null, landed: null });
    expect(new Date(deposit.reserved_until).getTime() - now().getTime()).toBeGreaterThan(9 * 60_000);
    const again = await reserve(user.headers, `h-${suffix}`, { token: "usdc", chain: "solana", amount: "200.00" });
    expect(again.json().address).toBe(deposit.address);

    const stranger = await holder("stranger");
    expect((await read(stranger.headers, deposit.deposit_id)).statusCode).toBe(404);

    await send(deposit.address, 200_000_000n);
    const landed = await pollUntil(user.headers, deposit.deposit_id, "landed");
    expect(landed).toMatchObject({ received: "200.00", landed: "199.800199" });
    expect(landed.seen_at).not.toBeNull();
    expect(landed.landed_at).not.toBeNull();
    expect(landed.seconds).toBeGreaterThanOrEqual(0);
    expect(landed.origin_tx).not.toBeNull();

    expect(await vault.getBalance(user.account)).toMatchObject({ available: 199_800_199n });
    expect(await unit((tx) => vaultMirror(tx, user.account, "USDC"))).toEqual({ available: 199_800_199n, reserved: 0n });
    const balance = (await app.inject({ method: "GET", url: "/v1/vault", headers: user.headers })).json();
    expect(balance).toMatchObject({ available: "199.800199", in_sync: true });

    await read(user.headers, deposit.deposit_id);
    expect(await vault.getBalance(user.account)).toMatchObject({ available: 199_800_199n });
  }, 90_000);

  it("shows an underpaid top-up, then its refund once the address expires", async () => {
    const user = await holder("short");
    const deposit = (await reserve(user.headers, `s-${suffix}`, { token: "usdc", chain: "base", amount: "100" })).json();
    await send(deposit.address, 50_000_000n);
    expect(await pollUntil(user.headers, deposit.deposit_id, "underpaid")).toMatchObject({ received: "50.00" });
    clock.offsetMs += 11 * 60_000;
    try {
      const refunded = await pollUntil(user.headers, deposit.deposit_id, "refunded");
      expect(refunded).toMatchObject({ refunded: "50.00", landed: null });
    } finally {
      clock.offsetMs -= 11 * 60_000;
    }
    expect(await vault.getBalance(user.account)).toMatchObject({ available: 0n });
  }, 90_000);

  it("expires an address nothing was sent to", async () => {
    const user = await holder("idle");
    const deposit = (await reserve(user.headers, `i-${suffix}`, { token: "usdc", chain: "arbitrum", amount: "20" })).json();
    clock.offsetMs += 11 * 60_000;
    try {
      expect((await read(user.headers, deposit.deposit_id)).json().state).toBe("expired");
    } finally {
      clock.offsetMs -= 11 * 60_000;
    }
  });

  it("lands a top-up nobody is watching through the background sweep", async () => {
    const user = await holder("sweep");
    const deposit = (await reserve(user.headers, `w-${suffix}`, { token: "usdc", chain: "polygon", amount: "10" })).json();
    await send(deposit.address, 10_000_000n);
    await pause(800);
    for (let attempt = 0; attempt < 5 && (await vault.getBalance(user.account)).available === 0n; attempt += 1) {
      await deposits.sweep(unit, 0);
      await pause(300);
    }
    expect((await vault.getBalance(user.account)).available).toBeGreaterThan(0n);
    expect(await unit((tx) => tx.vaultDeposit.findUniqueOrThrow({ where: { id: deposit.deposit_id } }))).toMatchObject({ state: "landed" });
  }, 60_000);
});
