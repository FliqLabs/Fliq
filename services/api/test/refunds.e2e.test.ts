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
import { createRefunds } from "../apps/api/src/refunds.js";
import { sandboxAdapters } from "../apps/api/src/sandbox.js";
import type { IntentsBalance } from "../packages/chains/near/index.js";
import { createOneClickClient, createOneClickMock, mockAssetId, type QuoteInput } from "../packages/chains/oneclick/index.js";
import { MockVault } from "../packages/chains/vault/index.js";
import { DEFAULT_ROUTING_CONFIG, NO_SIGNALS } from "../packages/domain/routing.js";

// Throwaway local database only; Prisma loads .env, which may point at a shared one.
const enabled = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") && Boolean(process.env.FLIQ_ACCESS_SECRET);
const USDC = "usdc.test.near";
const SOL_USDC = mockAssetId("sol", "USDC");
const BASE_USDC = mockAssetId("base", "USDC");

describe.skipIf(!enabled)("bringing a refunded top-up back to the vault", () => {
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
  const vault = new MockVault({ registrar: "registrar.test.near", usdc: USDC, now: () => BigInt(Date.now()) * 1_000_000n });

  // What each account holds on NEAR Intents, what 1Click was asked, and which addresses were looked up on Solana.
  const intents = new Map<string, IntentsBalance[]>();
  const quotes: QuoteInput[] = [];
  const solanaLookups: string[] = [];

  let server: Server;
  let mockUrl: string;
  let app: ReturnType<typeof buildApp>;
  let deposits: ReturnType<typeof createDeposits>;

  beforeAll(async () => {
    const mock = createOneClickMock({ now: () => new Date(), processingAfterMs: 100, settleAfterMs: 300 });
    server = createServer((req, res) => void mock.handle(req, res));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    mockUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const real = createOneClickClient({ baseUrl: mockUrl, apiKey: undefined });
    const client = {
      ...real,
      quote: async (input: QuoteInput, options?: Parameters<typeof real.quote>[1]) => {
        quotes.push(input);
        return real.quote(input, options);
      },
    };
    deposits = createDeposits({
      client,
      vaultAccount: config.vaultAccount,
      usdcContract: USDC,
      slippageBps: 200,
      pause: async () => {},
      arrivals: {
        solana: async ({ address }) => {
          solanaLookups.push(address);
          return null;
        },
      },
      onLanded: ({ units, message }) => void vault.ftOnTransfer({ predecessor: USDC, senderId: "intents.near", amount: units, msg: message }),
    });
    const refunds = createRefunds({
      client,
      vaultAccount: config.vaultAccount,
      usdcContract: USDC,
      slippageBps: 200,
      pause: async () => {},
      balances: async (account) => intents.get(account) ?? [],
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
        refunds,
        quotes: { adapters, routing: DEFAULT_ROUTING_CONFIG, signals: NO_SIGNALS, now: () => new Date() },
        payouts: { config, adapters, velocity: DEFAULT_VELOCITY, now: () => new Date() },
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

  async function holder(label: string) {
    const email = `refunds+${label}-${suffix}@example.test`;
    emails.push(email);
    await app.inject({ method: "POST", url: "/v1/auth/email-links", payload: { email } });
    const token = new URL(links.at(-1) as string).searchParams.get("token") as string;
    const session = (await app.inject({ method: "POST", url: "/v1/auth/email-links/verify", payload: { token } })).json();
    const headers = { authorization: `Bearer ${session.access_token}` };
    const name = `${label}-${suffix}`;
    const account = (await app.inject({ method: "POST", url: "/v1/me/name", payload: { name }, headers: { ...headers, "idempotency-key": `claim-${name}` } })).json().near_account as string;
    return { headers, account };
  }

  const list = (headers: Record<string, string>) => app.inject({ method: "GET", url: "/v1/refunds", headers });
  const bringBack = (headers: Record<string, string>, key: string, tokenId: string) =>
    app.inject({ method: "POST", url: "/v1/refunds/return", payload: { token_id: tokenId }, headers: { ...headers, "idempotency-key": key } });
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("lists a refunded USDC balance and hides dust and tokens 1Click does not know", async () => {
    const user = await holder("listed");
    intents.set(user.account, [
      { tokenId: SOL_USDC, units: 1_632_606n },
      { tokenId: BASE_USDC, units: 40_000n },
      { tokenId: "nep141:wrap.near", units: 5n * 10n ** 24n },
    ]);
    const reply = await list(user.headers);
    expect(reply.statusCode, reply.body).toBe(200);
    expect(reply.json()).toEqual({
      items: [{ token_id: SOL_USDC, symbol: "usdc", chain: "solana", units: "1632606", amount: "1.632606", intents_contract: "intents.near" }],
    });

    const empty = await holder("nothing");
    expect((await list(empty.headers)).json()).toEqual({ items: [] });
  });

  it("quotes the whole balance back to the vault and follows it like a top-up until it lands", async () => {
    const user = await holder("returned");
    intents.set(user.account, [{ tokenId: SOL_USDC, units: 1_632_606n }]);
    const reply = await bringBack(user.headers, `r-${suffix}`, SOL_USDC);
    expect(reply.statusCode, reply.body).toBe(201);
    const back = reply.json();
    expect(back).toEqual({
      deposit_id: expect.stringMatching(/^dep_/),
      deposit_address: expect.stringMatching(/^[0-9a-f]{64}$/),
      token_id: SOL_USDC,
      units: "1632606",
      lands: "1.630975",
      intents_contract: "intents.near",
    });
    expect(quotes.at(-1)).toMatchObject({
      dry: false,
      swapType: "EXACT_INPUT",
      depositType: "INTENTS",
      originAsset: SOL_USDC,
      destinationAsset: mockAssetId("near", "USDC"),
      amount: 1_632_606n,
      refundTo: user.account,
      refundType: "INTENTS",
      recipient: config.vaultAccount,
      customRecipientMsg: JSON.stringify({ top_up: { account_id: user.account } }),
      appFees: [],
    });
    const deadline = (quotes.at(-1) as QuoteInput).deadline.getTime() - Date.now();
    expect(deadline).toBeGreaterThan(25 * 60_000);
    expect(deadline).toBeLessThanOrEqual(30 * 60_000);

    const tracked = (await app.inject({ method: "GET", url: `/v1/deposits/${back.deposit_id}`, headers: user.headers })).json();
    expect(tracked).toMatchObject({ state: "waiting", token: "usdc", chain: "solana", address: back.deposit_address, amount: "1.632606", minimum: "1.632606" });

    await fetch(`${mockUrl}/mock/deposit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ depositAddress: back.deposit_address, amount: "1632606" }),
    });
    await pause(400);
    for (let attempt = 0; attempt < 5 && (await vault.getBalance(user.account)).available === 0n; attempt += 1) {
      await deposits.sweep(unit, 0);
      await pause(200);
    }
    expect(await vault.getBalance(user.account)).toMatchObject({ available: 1_630_975n });
    expect(await unit((tx) => tx.vaultDeposit.findUniqueOrThrow({ where: { id: back.deposit_id } }))).toMatchObject({ state: "landed", refundReturn: true });
    expect(solanaLookups).not.toContain(back.deposit_address);

    const activity = (await app.inject({ method: "GET", url: "/v1/activity", headers: user.headers })).json();
    expect(activity.items.find((item: { ref_id: string }) => item.ref_id === back.deposit_id)).toMatchObject({
      kind: "deposit",
      status: "received",
      party: { name: "Refund back in your vault" },
    });
  }, 60_000);

  it("answers a repeated key with the same deposit, without a second quote", async () => {
    const user = await holder("again");
    intents.set(user.account, [{ tokenId: SOL_USDC, units: 2_500_000n }]);
    const first = await bringBack(user.headers, `a-${suffix}`, SOL_USDC);
    expect(first.statusCode, first.body).toBe(201);
    const asked = quotes.length;
    const second = await bringBack(user.headers, `a-${suffix}`, SOL_USDC);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(quotes.length).toBe(asked);
    const rows = await unit((tx) => tx.vaultDeposit.count({ where: { account: user.account } }));
    expect(rows).toBe(1);
  });

  it("refuses an empty balance, dust, an unknown token and a missing key", async () => {
    const user = await holder("refused");
    intents.set(user.account, [
      { tokenId: BASE_USDC, units: 40_000n },
      { tokenId: "nep141:wrap.near", units: 5n * 10n ** 24n },
    ]);
    const asked = quotes.length;
    expect((await bringBack(user.headers, `e-${suffix}`, SOL_USDC)).statusCode).toBe(400);
    expect((await bringBack(user.headers, `d-${suffix}`, BASE_USDC)).statusCode).toBe(400);
    expect((await bringBack(user.headers, `u-${suffix}`, "nep141:wrap.near")).statusCode).toBe(400);
    const keyless = await app.inject({ method: "POST", url: "/v1/refunds/return", payload: { token_id: SOL_USDC }, headers: user.headers });
    expect(keyless.json().error.code).toBe("idempotency_key_required");
    expect(quotes.length).toBe(asked);
    expect(await unit((tx) => tx.vaultDeposit.count({ where: { account: user.account } }))).toBe(0);
  });
});
