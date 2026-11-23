import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OneClickError, type OneClickExecution, type OneClickToken, type QuoteInput } from "../packages/chains/oneclick/index.js";
import { MockVault } from "../packages/chains/vault/index.js";
import { MockProvisioner } from "../apps/api/src/accounts.js";
import { buildApp } from "../apps/api/src/app.js";
import type { EmailSender } from "../apps/api/src/auth/email-links.js";
import { loadConfig } from "../apps/api/src/config.js";
import { createDatabase, unitOf } from "../apps/api/src/db.js";
import { createHandlers } from "../apps/api/src/handlers.js";
import { DEFAULT_VELOCITY } from "../apps/api/src/payouts.js";
import { recordOutsideSend } from "../apps/api/src/people.js";
import { sandboxAdapters } from "../apps/api/src/sandbox.js";
import { createSends, markSendStarted, nextSend } from "../apps/api/src/sends.js";
import { DEFAULT_ROUTING_CONFIG, NO_SIGNALS } from "../packages/domain/routing.js";
import type { ProviderAdapter } from "../packages/providers/types.js";

// Throwaway local database only; Prisma loads .env, which may point at a shared one.
const enabled =
  /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") &&
  Boolean(process.env.FLIQ_ACCESS_SECRET);

const START = new Date("2026-11-15T10:00:00Z");
const USDC = "usdc.test.near";
// Made-up addresses with the right shape for each network.
const SOLANA_WALLET = "4Nd1mYQzvgV8Vr3Z3nYb7pD6T1K9wLx2aRkQeJcUuHsM";
const BASE_WALLET = "0x00000000000000000000000000000000000000a1";
const TRON_WALLET = "TA4Wt1DUCqz6YegbnsmqsWC5uUfbdBqPxm";

const execution = (status: OneClickExecution["status"], extra: Partial<OneClickExecution> = {}): OneClickExecution => ({
  status,
  updatedAt: START,
  depositedAmount: undefined,
  amountIn: undefined,
  amountOut: undefined,
  refundedAmount: undefined,
  refundReason: undefined,
  originTxHashes: [],
  destinationTxHashes: [],
  nearTxHashes: [],
  ...extra,
});

describe("what one 1Click answer does to a send", () => {
  const open = { state: "awaiting", expiresAt: new Date(START.getTime() + 600_000) };

  it("follows 1Click through to delivered or refunded", () => {
    expect(nextSend(open, execution("PROCESSING"), START)).toBe("moving");
    expect(nextSend(open, execution("SUCCESS"), START)).toBe("delivered");
    expect(nextSend(open, execution("REFUNDED"), START)).toBe("refunded");
  });

  it("expires a send nobody started, and never one that is moving", () => {
    const late = new Date(open.expiresAt.getTime() + 1);
    expect(nextSend(open, execution("PENDING_DEPOSIT"), late)).toBe("expired");
    expect(nextSend(open, undefined, late)).toBe("expired");
    expect(nextSend({ ...open, state: "moving" }, execution("PENDING_DEPOSIT"), late)).toBe("moving");
  });

  it("leaves a finished send alone", () => {
    expect(nextSend({ ...open, state: "delivered" }, execution("REFUNDED"), START)).toBe("delivered");
  });
});

describe.skipIf(!enabled)("sending USDC to a wallet on another network", () => {
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
  const adapter = sandboxAdapters(() => START)[0] as ProviderAdapter;
  let clock = START.getTime();
  const now = () => new Date(clock);

  const token = (blockchain: string, symbol = "USDC"): OneClickToken => ({
    assetId: `mock:${blockchain}:${symbol.toLowerCase()}`,
    decimals: blockchain === "bsc" ? 18 : 6,
    blockchain,
    symbol,
    contractAddress: blockchain === "near" ? USDC : undefined,
  });
  let listed = [token("near"), token("sol"), token("base"), token("tron", "USDT"), token("bsc", "USDT")];
  const quotes: QuoteInput[] = [];
  const statuses = new Map<string, OneClickExecution>();
  const ensured: string[] = [];
  let refuseNextQuotes = 0;
  let counter = 0;

  const sends = createSends({
    client: {
      tokens: async () => listed,
      quote: async (input) => {
        if (refuseNextQuotes > 0) {
          refuseNextQuotes -= 1;
          throw new OneClickError("quote", "unavailable", "simulated outage");
        }
        quotes.push(input);
        counter += 1;
        const scale = input.destinationAsset.startsWith("mock:bsc") ? 10n ** 12n : 1n;
        return {
          correlationId: `c${counter}`,
          signature: "sig",
          depositAddress: `${suffix}${String(counter).padStart(4, "0")}`.padEnd(64, "a"),
          depositMemo: undefined,
          amountIn: input.amount,
          minAmountIn: input.amount,
          amountOut: (input.amount - 30_000n) * scale,
          minAmountOut: (input.amount - 60_000n) * scale,
          amountInUsd: undefined,
          amountOutUsd: undefined,
          deadline: input.deadline,
          timeWhenInactive: undefined,
          timeEstimateSeconds: 38,
          raw: { mock: true },
        };
      },
      status: async (address) => statuses.get(address) ?? execution("PENDING_DEPOSIT"),
    },
    usdcContract: USDC,
    slippageBps: 100,
    tokenStorage: { ensure: async (account) => void ensured.push(account) },
    now,
    pause: async () => {},
  });

  const app = buildApp({
    config,
    unit,
    handlers: createHandlers({
      config,
      unit,
      email: sender,
      provisioner: new MockProvisioner(config.vaultAccount),
      vault: new MockVault({ registrar: "registrar.test.near", usdc: USDC, now: () => 0n }),
      quotes: { adapters: [adapter], routing: DEFAULT_ROUTING_CONFIG, signals: NO_SIGNALS, now },
      payouts: { config, adapters: [adapter], velocity: DEFAULT_VELOCITY, now },
      sends,
      now,
    }),
  });

  const userIds: string[] = [];
  const emails: string[] = [];

  async function signIn(label: string, claim = true) {
    const email = `sends+${label}-${suffix}@example.test`;
    emails.push(email);
    await app.inject({ method: "POST", url: "/v1/auth/email-links", payload: { email } });
    const linkToken = new URL(links.at(-1) as string).searchParams.get("token") as string;
    const session = (await app.inject({ method: "POST", url: "/v1/auth/email-links/verify", payload: { token: linkToken } })).json();
    const headers = { authorization: `Bearer ${session.access_token}` };
    userIds.push(session.user.user_id);
    let account = "";
    if (claim) {
      const name = `${label}-${suffix}`;
      account = (await app.inject({ method: "POST", url: "/v1/me/name", payload: { name }, headers: { ...headers, "idempotency-key": `claim-${name}` } })).json().near_account;
    }
    return { headers, account, userId: session.user.user_id as string };
  }

  const start = (headers: Record<string, string>, payload: object, key = `k-${randomBytes(6).toString("hex")}`) =>
    app.inject({ method: "POST", url: "/v1/sends", payload, headers: { ...headers, "idempotency-key": key } });
  const read = (headers: Record<string, string>, id: string) => app.inject({ method: "GET", url: `/v1/sends/${id}`, headers });

  beforeAll(async () => {
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await database.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.$executeRaw`DELETE FROM core.wallet_sends WHERE user_id = ANY(${userIds}::text[])`;
      await tx.$executeRaw`DELETE FROM core.transfers WHERE from_user_id = ANY(${userIds}::text[])`;
      await tx.$executeRaw`DELETE FROM developer.idempotency_records WHERE scope = ANY(${userIds}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.sessions WHERE user_id = ANY(${userIds}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.users WHERE id = ANY(${userIds}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.email_links WHERE email = ANY(${emails}::text[])`;
    });
    await database.$disconnect();
  }, 60_000);

  it("lists the networks, and marks one NEAR Intents cannot reach", async () => {
    const user = await signIn("networks");
    const all = (await app.inject({ method: "GET", url: "/v1/sends/networks", headers: user.headers })).json();
    expect(all.networks.map((network: { chain: string }) => network.chain)).toEqual(["solana", "base"]);
    expect(all.networks.every((network: { available: boolean }) => network.available)).toBe(true);

    const both = (await app.inject({ method: "GET", url: "/v1/sends/networks?tokens=usdc,usdt", headers: user.headers })).json();
    expect(both.networks.map((network: { chain: string; token: string }) => `${network.chain}:${network.token}`)).toEqual([
      "solana:usdc",
      "base:usdc",
      "tron:usdt",
      "bnb:usdt",
    ]);

    const before = listed;
    listed = [token("near"), token("sol")];
    clock += 61_000;
    const fewer = (await app.inject({ method: "GET", url: "/v1/sends/networks", headers: user.headers })).json();
    expect(fewer.networks.find((network: { chain: string }) => network.chain === "base").available).toBe(false);
    listed = before;
    clock += 61_000;
  }, 60_000);

  it("sends USDT to Tron and to BNB Chain, counting BNB Chain's 18 decimals in dollars", async () => {
    const user = await signIn("usdt");
    const tron = await start(user.headers, { chain: "tron", address: TRON_WALLET, amount: "10" });
    expect(tron.statusCode, tron.body).toBe(201);
    expect(tron.json()).toMatchObject({ token: "usdt", chain: "tron", receives: "9.97", fee: "0.03" });
    expect(quotes.at(-1)).toMatchObject({ destinationAsset: "mock:tron:usdt", recipient: TRON_WALLET, refundTo: user.account });

    const bnb = await start(user.headers, { chain: "bnb", address: BASE_WALLET, amount: "10" });
    expect(bnb.statusCode, bnb.body).toBe(201);
    expect(bnb.json()).toMatchObject({ token: "usdt", chain: "bnb", amount: "10.00", receives: "9.97", fee: "0.03" });

    const small = await start(user.headers, { chain: "tron", address: TRON_WALLET, amount: "4" });
    expect(small.json().error.message).toContain("$10.00");
    const typo = await start(user.headers, { chain: "tron", address: "TA4Wt1DUCqz6YegbnsmqsWC5uUfbdBqPxa", amount: "10" });
    expect(typo.json().error.message, "a mistyped character fails the checksum").toContain("not a Tron address");
  }, 60_000);

  it("quotes a send, with the refund going to the user's own account and both accounts able to hold USDC", async () => {
    const user = await signIn("quote");
    const reply = await start(user.headers, { chain: "solana", address: SOLANA_WALLET, amount: "10" });
    expect(reply.statusCode, reply.body).toBe(201);
    const send = reply.json();
    expect(send).toMatchObject({ state: "awaiting", token: "usdc", chain: "solana", to: SOLANA_WALLET, amount: "10.00", receives: "9.97", fee: "0.03", eta_seconds: 38 });
    expect(send.deposit.address).toHaveLength(64);
    expect(send.deposit.expires_at).toBe(new Date(clock + 10 * 60_000).toISOString());

    expect(quotes.at(-1)).toMatchObject({
      dry: false,
      swapType: "EXACT_INPUT",
      originAsset: "mock:near:usdc",
      destinationAsset: "mock:sol:usdc",
      amount: 10_000_000n,
      recipient: SOLANA_WALLET,
      refundTo: user.account,
      refundType: "ORIGIN_CHAIN",
    });
    expect(ensured).toEqual(expect.arrayContaining([send.deposit.address, user.account]));
  }, 60_000);

  it("returns the same send for the same idempotency key", async () => {
    const user = await signIn("replay");
    const first = (await start(user.headers, { chain: "base", address: BASE_WALLET, amount: "5.00" }, `same-${suffix}`)).json();
    const again = (await start(user.headers, { chain: "base", address: BASE_WALLET, amount: "5.00" }, `same-${suffix}`)).json();
    expect(again.send_id).toBe(first.send_id);
    expect(await database.walletSend.count({ where: { userId: user.userId } })).toBe(1);
  }, 60_000);

  it("refuses an address with the wrong shape for the network, an unknown network and too small an amount", async () => {
    const user = await signIn("refuse");
    const before = quotes.length;
    for (const payload of [
      { chain: "solana", address: BASE_WALLET, amount: "10" },
      { chain: "base", address: SOLANA_WALLET, amount: "10" },
      { chain: "base", address: "0x123", amount: "10" },
      { chain: "tron", address: "TXYZ", amount: "10" },
      { chain: "solana", address: SOLANA_WALLET, amount: "0.50" },
      { chain: "solana", address: SOLANA_WALLET, amount: "abc" },
    ]) {
      const reply = await start(user.headers, payload);
      expect(reply.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect((await start(user.headers, { chain: "base", address: SOLANA_WALLET, amount: "10" })).json().error.message).toContain("not a Base address");
    expect(quotes.length, "nothing reaches NEAR Intents").toBe(before);
    expect(await database.walletSend.count({ where: { userId: user.userId } })).toBe(0);
  }, 60_000);

  it("needs a fliq name, and asks NEAR Intents again before giving up", async () => {
    const nameless = await signIn("nameless", false);
    expect((await start(nameless.headers, { chain: "solana", address: SOLANA_WALLET, amount: "10" })).statusCode).toBe(404);

    const user = await signIn("retry");
    refuseNextQuotes = 2;
    expect((await start(user.headers, { chain: "solana", address: SOLANA_WALLET, amount: "10" })).statusCode).toBe(201);
    refuseNextQuotes = 3;
    const failed = await start(user.headers, { chain: "solana", address: SOLANA_WALLET, amount: "10" });
    expect(failed.statusCode).toBe(503);
    expect(failed.json().error.message).toContain("Solana");
    refuseNextQuotes = 0;
  }, 60_000);

  it("moves from awaiting to moving when the user's transfer is relayed, then to delivered, and only its owner can read it", async () => {
    const user = await signIn("follow");
    const send = (await start(user.headers, { chain: "solana", address: SOLANA_WALLET, amount: "10" })).json();

    expect(await unit((tx) => markSendStarted(tx, "someone-else", send.deposit.address, "tx-near-1"))).toBe(false);
    expect(await unit((tx) => markSendStarted(tx, user.userId, send.deposit.address, "tx-near-1"))).toBe(true);
    clock += 4_000;
    expect((await read(user.headers, send.send_id)).json()).toMatchObject({ state: "moving", origin_tx: "tx-near-1" });

    statuses.set(send.deposit.address, execution("SUCCESS", { amountOut: 9_975_000n, destinationTxHashes: ["sol-tx-1"] }));
    clock += 1_000;
    expect((await read(user.headers, send.send_id)).json().state, "1Click is asked at most every 3 seconds").toBe("moving");
    clock += 3_000;
    expect((await read(user.headers, send.send_id)).json()).toMatchObject({ state: "delivered", receives: "9.975", destination_tx: "sol-tx-1" });

    const stranger = await signIn("stranger");
    expect((await read(stranger.headers, send.send_id)).statusCode).toBe(404);
  }, 60_000);

  it("follows sends nobody is watching: a refund is recorded and an untouched send expires", async () => {
    const user = await signIn("sweep");
    const refunded = (await start(user.headers, { chain: "base", address: BASE_WALLET, amount: "20" })).json();
    const untouched = (await start(user.headers, { chain: "base", address: BASE_WALLET, amount: "20" })).json();
    await unit((tx) => markSendStarted(tx, user.userId, refunded.deposit.address, "tx-near-2"));
    statuses.set(refunded.deposit.address, execution("REFUNDED", { refundReason: "deadline exceeded" }));

    clock += 11 * 60_000;
    expect(await sends.sweep(unit)).toBeGreaterThanOrEqual(2);
    expect((await database.walletSend.findUniqueOrThrow({ where: { id: refunded.send_id } })).state).toBe("refunded");
    expect((await database.walletSend.findUniqueOrThrow({ where: { id: untouched.send_id } })).state).toBe("expired");
  }, 60_000);

  it("shows the send in Activity by where it is really going, pending until it is delivered", async () => {
    const user = await signIn("activity");
    const send = (await start(user.headers, { chain: "solana", address: SOLANA_WALLET, amount: "10" })).json();
    const txHash = `tx-${suffix}-activity`;
    await unit(async (tx) => {
      await markSendStarted(tx, user.userId, send.deposit.address, txHash);
      await recordOutsideSend(tx, user.userId, { txHash, from: user.account, to: send.deposit.address, amount: 10_000_000n });
    });

    const activity = async () => (await app.inject({ method: "GET", url: "/v1/activity", headers: user.headers })).json().items[0];
    expect(await activity()).toMatchObject({ kind: "transfer_out", status: "pending", usd: "10.00", party: { name: "Solana wallet 4Nd1mY...uHsM" } });

    statuses.set(send.deposit.address, execution("SUCCESS", { destinationTxHashes: ["sol-tx-2"] }));
    clock += 4_000;
    await read(user.headers, send.send_id);
    expect((await activity()).status).toBe("sent");
  }, 60_000);
});
