import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MockProvisioner } from "../apps/api/src/accounts.js";
import { buildApp } from "../apps/api/src/app.js";
import type { EmailSender } from "../apps/api/src/auth/email-links.js";
import { loadConfig } from "../apps/api/src/config.js";
import { createDatabase, unitOf } from "../apps/api/src/db.js";
import { createDeposits } from "../apps/api/src/deposits.js";
import { createHandlers } from "../apps/api/src/handlers.js";
import { DEFAULT_VELOCITY } from "../apps/api/src/payouts.js";
import { sandboxAdapters } from "../apps/api/src/sandbox.js";
import { createOneClickClient, createOneClickMock, OneClickError, type DepositSubmission, type OneClickClient } from "../packages/chains/oneclick/index.js";
import { MockVault } from "../packages/chains/vault/index.js";
import type { Arrival } from "../packages/chains/watchers/index.js";
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

  // What the stand-in Solana RPC answers for an address, and what 1Click was told.
  const onSolana = new Map<string, Arrival | Error>();
  const submissions: DepositSubmission[] = [];
  const oneClick = { quoteRefusals: 0, refusesSubmissions: false, takesFloor: false };
  // What the team would be told, and where this API says it can be reached.
  const alerts: string[] = [];
  const publicBaseUrl = "https://api.example.test";
  const toldOneClick = (address: string) => submissions.filter((submission) => submission.depositAddress === address);

  let server: Server;
  let mockUrl: string;
  let app: ReturnType<typeof buildApp>;
  let deposits: ReturnType<typeof createDeposits>;

  beforeAll(async () => {
    const mock = createOneClickMock({ now, processingAfterMs: 200, settleAfterMs: 600 });
    server = createServer((req, res) => void mock.handle(req, res));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    mockUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const real = createOneClickClient({ baseUrl: mockUrl, apiKey: undefined });
    const client: OneClickClient = {
      ...real,
      // Live 1Click names each Solana token's mint; the mock does not.
      tokens: async () => (await real.tokens()).map((token) => (token.blockchain === "sol" ? { ...token, contractAddress: `mint-${token.symbol}` } : token)),
      quote: async (input, options) => {
        if (oneClick.quoteRefusals > 0) {
          oneClick.quoteRefusals -= 1;
          throw new OneClickError("quote", "rejected", "try again", 400);
        }
        // Real 1Click quotes a FLEX address for as little as a cent; the mock's floor is a dollar.
        if (oneClick.takesFloor && input.amount < 1_000_000n) {
          const quoted = await real.quote({ ...input, amount: 1_000_000n }, options);
          return { ...quoted, minAmountIn: (input.amount * 99n) / 100n };
        }
        return real.quote(input, options);
      },
      submitDeposit: async (submission) => {
        submissions.push(submission);
        if (oneClick.refusesSubmissions) throw new OneClickError("submitDeposit", "rejected", "unknown transaction", 400);
        return real.submitDeposit(submission);
      },
    };
    deposits = createDeposits({
      client,
      arrivals: {
        solana: async ({ address }) => {
          // Long enough for two readers of one deposit to both be holding a sighting.
          await pause(50);
          const found = onSolana.get(address) ?? null;
          if (found instanceof Error) throw found;
          return found;
        },
      },
      vaultAccount: config.vaultAccount,
      usdcContract: USDC,
      slippageBps: 200,
      pause: async () => {},
      now,
      publicBaseUrl,
      alert: (message) => void alerts.push(message),
      onLanded: ({ units, message }) => void vault.ftOnTransfer({ predecessor: USDC, senderId: "intents.near", amount: units, msg: message }),
    });
    const adapters = sandboxAdapters();
    app = buildApp({
      config,
      unit,
      logger: Boolean(process.env.E2E_LOG),
      bankWebhook: (depositId, token, rawBody) => deposits.bankWebhook(unit, depositId, token, rawBody),
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
    expect(sources.map((s: { chain: string }) => s.chain)).toEqual([
      "base", "solana", "arbitrum", "ethereum", "polygon", "bnb", "monad",
      "solana", "ethereum", "bnb", "polygon", "tron", "bitcoin", "near",
    ]);
    expect(sources.find((s: { chain: string }) => s.chain === "near")).toMatchObject({ direct: true, available: true, address: user.account });
    expect(sources.find((s: { chain: string }) => s.chain === "bitcoin")).toMatchObject({ available: false, address: null });
    expect(sources.find((s: { chain: string }) => s.chain === "tron")).toMatchObject({ minimum: "110.00", available: true });
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
    expect(tron.json().error.message).toContain("110.00 USDT");
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

  it("lands a delivery that is short of what the user typed, as a bank partner's fee makes it", async () => {
    const user = await holder("partnerfee");
    oneClick.takesFloor = true;
    const deposit = (await reserve(user.headers, `pf-${suffix}`, { token: "usdc", chain: "base", amount: "2.00" })).json();
    oneClick.takesFloor = false;
    expect(deposit.minimum).toBe("0.099");
    await send(deposit.address, 1_590_000n);
    expect((await pollUntil(user.headers, deposit.deposit_id, "landed")).state).toBe("landed");
  }, 60_000);

  it("asks 1Click again when it refuses a quote, and only gives up after the third refusal", async () => {
    const user = await holder("retry");
    oneClick.quoteRefusals = 2;
    const created = await reserve(user.headers, `r-${suffix}`, { token: "usdc", chain: "solana", amount: "200.00" });
    expect(created.statusCode, created.body).toBe(201);
    expect(oneClick.quoteRefusals).toBe(0);

    // One refusal goes to the ten-cent floor quote, which is tried once and then left for the amount typed.
    oneClick.quoteRefusals = 4;
    const refused = await reserve(user.headers, `r2-${suffix}`, { token: "usdc", chain: "solana", amount: "200.00" });
    expect(refused.statusCode).toBe(400);
    oneClick.quoteRefusals = 0;
  });

  it("shows a Solana top-up as seen as soon as it is on Solana, tells 1Click once and credits nothing until 1Click delivers", async () => {
    const user = await holder("sighted");
    const deposit = (await reserve(user.headers, `g-${suffix}`, { token: "usdc", chain: "solana", amount: "200.00" })).json();
    onSolana.set(deposit.address, { amount: 200_000_000n, txHash: "5SolanaSig" });

    const [first, second] = await Promise.all([read(user.headers, deposit.deposit_id), read(user.headers, deposit.deposit_id)]);
    for (const view of [first.json(), second.json()]) {
      if (view.state === "waiting") continue;
      expect(view).toMatchObject({ state: "seen", received: "200.00", origin_tx: "5SolanaSig", landed: null, landed_at: null });
      expect(view.seen_at).not.toBeNull();
    }
    expect((await read(user.headers, deposit.deposit_id)).json().state).toBe("seen");
    expect(await vault.getBalance(user.account)).toMatchObject({ available: 0n });
    expect(await unit((tx) => vaultMirror(tx, user.account, "USDC"))).toEqual({ available: 0n, reserved: 0n });

    await vi.waitFor(() => expect(toldOneClick(deposit.address)).toEqual([{ txHash: "5SolanaSig", depositAddress: deposit.address }]));
    const landed = await pollUntil(user.headers, deposit.deposit_id, "landed");
    expect(landed).toMatchObject({ received: "200.00", landed: "199.800199", origin_tx: "5SolanaSig" });
    expect(await vault.getBalance(user.account)).toMatchObject({ available: 199_800_199n });
    expect(await unit((tx) => vaultMirror(tx, user.account, "USDC"))).toEqual({ available: 199_800_199n, reserved: 0n });
    expect(toldOneClick(deposit.address)).toHaveLength(1);
  }, 90_000);

  it("changes nothing when Solana cannot be read or shows less than the minimum", async () => {
    const user = await holder("blind");
    const deposit = (await reserve(user.headers, `r-${suffix}`, { token: "usdc", chain: "solana", amount: "200.00" })).json();
    const stored = () => unit((tx) => tx.vaultDeposit.findUniqueOrThrow({ where: { id: deposit.deposit_id } }));

    onSolana.set(deposit.address, new Error("rpc unavailable"));
    expect((await read(user.headers, deposit.deposit_id)).json()).toMatchObject({ state: "waiting", received: null, seen_at: null, origin_tx: null });
    onSolana.set(deposit.address, { amount: 50_000_000n, txHash: "5ShortSig" });
    await deposits.sweep(unit, 0);
    expect(await stored()).toMatchObject({ state: "waiting", receivedUnits: null, seenAt: null, originTx: null });
    expect(toldOneClick(deposit.address)).toEqual([]);
    expect(await vault.getBalance(user.account)).toMatchObject({ available: 0n });

    onSolana.set(deposit.address, new Error("rpc unavailable"));
    await send(deposit.address, 200_000_000n);
    expect(await pollUntil(user.headers, deposit.deposit_id, "landed")).toMatchObject({ received: "200.00", landed: "199.800199" });
    expect(toldOneClick(deposit.address)).toEqual([]);
  }, 90_000);

  it("keeps following a top-up when 1Click refuses to be told about it", async () => {
    const user = await holder("refused");
    const deposit = (await reserve(user.headers, `f-${suffix}`, { token: "usdt", chain: "solana", amount: "20" })).json();
    onSolana.set(deposit.address, { amount: 20_000_000n, txHash: "5UsdtSig" });
    oneClick.refusesSubmissions = true;
    try {
      expect((await read(user.headers, deposit.deposit_id)).json()).toMatchObject({ state: "seen", received: "20.00" });
      await vi.waitFor(() => expect(toldOneClick(deposit.address)).toHaveLength(1));
    } finally {
      oneClick.refusesSubmissions = false;
    }
    expect(await vault.getBalance(user.account)).toMatchObject({ available: 0n });
    await send(deposit.address, 20_000_000n);
    const landed = await pollUntil(user.headers, deposit.deposit_id, "landed");
    expect(landed.landed).not.toBeNull();
    expect((await vault.getBalance(user.account)).available).toBeGreaterThan(0n);
    expect(toldOneClick(deposit.address)).toHaveLength(1);
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

  // MARK: bank deposits

  const report = (headers: Record<string, string>, id: string, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: `/v1/deposits/${id}/bank-order`, payload, headers });
  const hook = (url: string, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: new URL(url).pathname, payload: JSON.stringify(payload), headers: { "content-type": "application/json" } });
  const listed = async (headers: Record<string, string>, id: string) =>
    ((await app.inject({ method: "GET", url: "/v1/activity?limit=50", headers })).json().items as { ref_id: string; status: string; reason: string | null; party: { name: string } }[]).find(
      (item) => item.ref_id === id,
    );

  it("follows a bank deposit through the partner's order, shows it from the moment it is sent and says when it stops", async () => {
    const user = await holder("bank");
    const other = await holder("nosy");
    const deposit = (await reserve(user.headers, `b-${suffix}`, { token: "usdc", chain: "solana", amount: "33.77", via: "bank" })).json();
    expect(deposit.bank_status).toBeNull();
    expect(deposit.bank_webhook_url).toMatch(new RegExp(`^${publicBaseUrl}/v1/bank-deposits/${deposit.deposit_id}/[A-Za-z0-9_-]{32}$`));
    expect(await listed(user.headers, deposit.deposit_id), "Bank details alone are not a deposit").toBeUndefined();

    expect((await report(other.headers, deposit.deposit_id, { order_id: "ord_bank_1" })).statusCode, "Only the owner reports").toBe(404);
    const sent = await report(user.headers, deposit.deposit_id, { order_id: "ord_bank_1", status: "init", sent: true });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().bank_status).toBe("INIT");
    expect(await listed(user.headers, deposit.deposit_id)).toMatchObject({ status: "pending", reason: null, party: { name: "From your bank" } });
    expect((await report(user.headers, deposit.deposit_id, { order_id: "ord_other" })).statusCode, "One deposit, one order").toBe(400);

    const forged = deposit.bank_webhook_url.replace(/[^/]+$/, "x".repeat(32));
    expect((await hook(forged, { id: "ord_bank_1", status: "COMPLETED" })).statusCode).toBe(404);
    expect((await read(user.headers, deposit.deposit_id)).json().bank_status, "A forged link changes nothing").toBe("INIT");

    const before = alerts.length;
    expect((await hook(deposit.bank_webhook_url, { id: "ord_bank_1", status: "ERROR", fiatAmount: 50000 })).statusCode).toBe(200);
    expect((await read(user.headers, deposit.deposit_id)).json().bank_status).toBe("ERROR");
    expect(await listed(user.headers, deposit.deposit_id), "The partner retries after ERROR").toMatchObject({ status: "pending", reason: null });
    expect(alerts.length, "Nobody is woken for an ERROR that may pass").toBe(before);

    await hook(deposit.bank_webhook_url, { id: "ord_bank_1", status: "FAILED" });
    expect(await listed(user.headers, deposit.deposit_id)).toMatchObject({ status: "failed", reason: "bank_stopped" });
    expect(alerts.slice(before)).toEqual([expect.stringContaining("ord_bank_1 FAILED")]);

    await hook(deposit.bank_webhook_url, { id: "ord_bank_1", status: "FAILED" });
    await report(user.headers, deposit.deposit_id, { order_id: "ord_bank_1", status: "FAILED" });
    expect(alerts.length - before, "The team is told once").toBe(1);
  });

  it("tells the team when an ERROR has lasted a quarter of an hour without landing", async () => {
    const user = await holder("errbank");
    const deposit = (await reserve(user.headers, `eb-${suffix}`, { token: "usdc", chain: "solana", amount: "10", via: "bank" })).json();
    await report(user.headers, deposit.deposit_id, { order_id: "ord_err_1", status: "INIT", sent: true });
    await hook(deposit.bank_webhook_url, { id: "ord_err_1", status: "ERROR" });
    const before = alerts.length;
    clock.offsetMs += 10 * 60_000;
    try {
      await deposits.overdueBank(unit);
      expect(alerts.length, "Ten minutes is how long the 20 Nov order took to recover").toBe(before);
      clock.offsetMs += 6 * 60_000;
      await deposits.overdueBank(unit);
      await deposits.overdueBank(unit);
      expect(alerts.slice(before)).toEqual([expect.stringContaining("ord_err_1 at ERROR for 16 min")]);
    } finally {
      clock.offsetMs -= 16 * 60_000;
    }
  });

  it("tells the team once when a sent bank deposit is still waiting an hour later", async () => {
    const user = await holder("slowbank");
    const deposit = (await reserve(user.headers, `sb-${suffix}`, { token: "usdc", chain: "solana", amount: "10", via: "bank" })).json();
    await report(user.headers, deposit.deposit_id, { order_id: "ord_slow_1", status: "INIT", sent: true });
    const before = alerts.length;
    await deposits.overdueBank(unit);
    expect(alerts.length, "Not yet an hour").toBe(before);

    clock.offsetMs += 61 * 60_000;
    try {
      await deposits.overdueBank(unit);
      await deposits.overdueBank(unit);
      expect(alerts.slice(before)).toEqual([expect.stringContaining("ord_slow_1 at INIT")]);
      expect(await listed(user.headers, deposit.deposit_id), "Still shown as on its way, not expired").toMatchObject({ status: "pending" });
    } finally {
      clock.offsetMs -= 61 * 60_000;
    }
  });
});
