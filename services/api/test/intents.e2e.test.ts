import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockProvisioner } from "../apps/api/src/accounts.js";
import { buildApp } from "../apps/api/src/app.js";
import type { EmailSender } from "../apps/api/src/auth/email-links.js";
import { loadConfig } from "../apps/api/src/config.js";
import { createDatabase, unitOf } from "../apps/api/src/db.js";
import { createHandlers } from "../apps/api/src/handlers.js";
import { OneClickHops } from "../apps/api/src/hop.js";
import { DEFAULT_DEADLINE_MARGIN_MS, DEFAULT_GUARD_BPS, DEFAULT_VELOCITY } from "../apps/api/src/payouts.js";
import { sandboxAdapters } from "../apps/api/src/sandbox.js";
import { createOneClickClient, createOneClickMock, OneClickError, type OneClickClient } from "../packages/chains/oneclick/index.js";
import { MockVault, type VaultClient } from "../packages/chains/vault/index.js";
import { DEFAULT_ROUTING_CONFIG, NO_SIGNALS } from "../packages/domain/routing.js";
import { postEntry, vaultMirror } from "../packages/ledger/post.js";
import { vaultCredited } from "../packages/ledger/postings.js";
import type { CreateOrderRequest, ProviderAdapter } from "../packages/providers/types.js";

// Throwaway local database only; Prisma loads .env, which may point at a shared one.
const enabled = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") && Boolean(process.env.FLIQ_ACCESS_SECRET);
const USDC = "usdc.test.near";
const PAYCREST_ADDRESS = "0x76b4c56085ed136a8744d52be956396624a730e8";
const ACCOUNT = { bank: "058", number: "0123456789" };

describe.skipIf(!enabled)("paying a bank account from the vault through NEAR Intents", () => {
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
  const vault = new MockVault({ registrar: "registrar.test.near", usdc: USDC, now: () => BigInt(Date.now()) * 1_000_000n });
  const emails: string[] = [];

  let server: Server;
  let rawClient: OneClickClient;
  const trouble = { spike: false, failQuote: false, failRegister: false };
  // The real client, with switches to make the swap quote worse or fail after the provider order exists.
  const client: OneClickClient = {
    tokens: (options) => rawClient.tokens(options),
    submitDeposit: (submission, options) => rawClient.submitDeposit(submission, options),
    status: (address, memo, options) => rawClient.status(address, memo, options),
    async quote(input, options) {
      if (!input.dry && trouble.failQuote) throw new OneClickError("quote", "unavailable", "simulated outage");
      const quote = await rawClient.quote(input, options);
      if (input.dry || !trouble.spike) return quote;
      return { ...quote, amountIn: (quote.amountIn * 102n) / 100n, minAmountIn: (quote.minAmountIn * 102n) / 100n };
    },
  };

  const orders: string[] = [];
  const base = sandboxAdapters()[0] as ProviderAdapter;
  // Accepts USDC on Base only, as Paycrest does, and hands back a Base deposit address that is valid for 15 minutes.
  const paycrest: ProviderAdapter = {
    ...base,
    id: "paycrest",
    quote: async (request) => ({ ...(await base.quote(request)), provider: "paycrest" }),
    capabilities: () => ({ ...base.capabilities(), provider: "paycrest", sources: [{ asset: "USDC", chain: "base" }] }),
    async createOrder(request: CreateOrderRequest) {
      orders.push(request.payoutId);
      const created = await base.createOrder(request);
      return {
        ...created,
        funding: { kind: "deposit_address", chain: "base", asset: "USDC", address: PAYCREST_ADDRESS, units: request.quote.sendUnits, validUntil: new Date(Date.now() + 15 * 60_000) },
      };
    },
  };
  // The real mock vault, with a switch to refuse order registration.
  const faultyVault: VaultClient = {
    registerOrder: (input) => (trouble.failRegister ? Promise.reject(new Error("vault unavailable")) : vault.registerOrder(input)),
    setStatus: (orderId, status, refs) => vault.setStatus(orderId, status, refs),
    recredit: (orderId, amount) => vault.recredit(orderId, amount),
    releaseOrder: (orderId) => vault.releaseOrder(orderId),
    getReceipt: (orderId) => vault.getReceipt(orderId),
    getBalance: (accountId) => vault.getBalance(accountId),
    getPolicy: (publicKey) => vault.getPolicy(publicKey),
  };

  let app: ReturnType<typeof buildApp>;
  let hops: OneClickHops;

  beforeAll(async () => {
    const mock = createOneClickMock({ now: () => new Date() });
    server = createServer((req, res) => void mock.handle(req, res));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    rawClient = createOneClickClient({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, apiKey: undefined });
    hops = new OneClickHops({ client, slippageBps: 10, pricingRefundTo: config.vaultAccount, pricingRecipient: PAYCREST_ADDRESS });
    const quotes = { adapters: [paycrest], hop: hops, routing: DEFAULT_ROUTING_CONFIG, signals: NO_SIGNALS, now: () => new Date() };
    app = buildApp({
      config,
      unit,
      logger: Boolean(process.env.E2E_LOG),
      handlers: createHandlers({
        config,
        unit,
        email: sender,
        provisioner: new MockProvisioner(config.vaultAccount, (account) => vault.registerStorage(account)),
        vault: faultyVault,
        quotes,
        payouts: {
          config,
          adapters: [paycrest],
          velocity: DEFAULT_VELOCITY,
          now: () => new Date(),
          intents: { hops, vault: faultyVault, guardBps: DEFAULT_GUARD_BPS, deadlineMarginMs: DEFAULT_DEADLINE_MARGIN_MS },
        },
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
      await tx.$executeRaw`DELETE FROM ledger.journal_lines WHERE entry_id IN (SELECT e.id FROM ledger.journal_entries e JOIN core.payouts p ON p.id = e.payout_id WHERE p.developer_id = ANY(${ids}::text[]))`;
      await tx.$executeRaw`DELETE FROM ledger.journal_entries WHERE payout_id IN (SELECT id FROM core.payouts WHERE developer_id = ANY(${ids}::text[])) OR payout_id LIKE ${`%${suffix}%`}`;
      await tx.$executeRaw`DELETE FROM ledger.balances WHERE account_id IN (SELECT id FROM ledger.accounts WHERE code LIKE ${`%${suffix}%`})`;
      await tx.$executeRaw`DELETE FROM ledger.accounts WHERE code LIKE ${`%${suffix}%`}`;
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

  async function holder(label: string, funds: bigint, claim = true) {
    const email = `intents+${label}-${suffix}@example.test`;
    emails.push(email);
    await app.inject({ method: "POST", url: "/v1/auth/email-links", payload: { email } });
    const token = new URL(links.at(-1) as string).searchParams.get("token") as string;
    const session = (await app.inject({ method: "POST", url: "/v1/auth/email-links/verify", payload: { token } })).json();
    const headers = { authorization: `Bearer ${session.access_token}` };
    let account = "";
    if (claim) {
      const name = `${label}-${suffix}`;
      account = (await app.inject({ method: "POST", url: "/v1/me/name", payload: { name }, headers: { ...headers, "idempotency-key": `claim-${name}` } })).json().near_account;
      if (funds > 0n) {
        vault.ftOnTransfer({ predecessor: USDC, senderId: account, amount: funds, msg: "" });
        await unit((tx) => postEntry(tx, vaultCredited(`fund-${label}-${suffix}`, account, "USDC", funds)));
      }
    }
    return { headers, account, userId: session.user.user_id as string };
  }

  const quote = async (headers: Record<string, string>, amount = "50.00") => {
    const reply = await app.inject({ method: "POST", url: "/v1/quotes", payload: { token: "usdc", currency: "ngn", amount, source_chain: "near" }, headers });
    expect(reply.statusCode, reply.body).toBe(200);
    return reply.json();
  };
  const pay = (headers: Record<string, string>, key: string, quoteId: string) =>
    app.inject({ method: "POST", url: "/v1/payouts", payload: { quote_id: quoteId, account: ACCOUNT }, headers: { ...headers, "idempotency-key": key } });
  const reset = () => Object.assign(trouble, { spike: false, failQuote: false, failRegister: false });

  it("quotes a NEAR to bank route as an Intents route that costs the hop and takes longer", async () => {
    const user = await holder("quote", 0n);
    const result = await quote(user.headers);
    expect(result.provider).toBe("paycrest");
    expect(result.routes[0]).toMatchObject({ routed: true, via_intents: true });
    expect(result.receive).toBeLessThan(68816);
    expect(result.fees.total).toBeGreaterThan(34400);
    expect(result.eta_seconds).toBeGreaterThan(21);
  }, 60_000);

  it("registers the vault order, reserves the funds and returns a NEAR deposit for the user to sign", async () => {
    reset();
    const user = await holder("happy", 100_000_000n);
    const quoted = await quote(user.headers);
    const reply = await pay(user.headers, `k-${suffix}-ok`, quoted.quote_id);
    expect(reply.statusCode, reply.body).toBe(201);
    const payout = reply.json();
    expect(payout).toMatchObject({ state: "awaiting_deposit", provider: "paycrest", account_name: "DARA OKONKWO" });
    expect(payout.deposit.chain).toBe("near");
    expect(payout.deposit.address).not.toBe(PAYCREST_ADDRESS);
    expect(payout.vault_receipt).toBe(payout.payout_id);
    expect(Number(payout.deposit.amount)).toBeGreaterThanOrEqual(50);

    const receipt = await vault.getReceipt(payout.payout_id);
    expect(receipt).toMatchObject({ state: "registered", payer: user.account, depositAddress: payout.deposit.address });
    const reserved = receipt?.amount as bigint;
    expect(await vault.getBalance(user.account)).toEqual({ available: 100_000_000n - reserved, reserved, total: 100_000_000n });
    expect(await unit((tx) => vaultMirror(tx, user.account, "USDC"))).toEqual({ available: 100_000_000n - reserved, reserved });
    const view = (await app.inject({ method: "GET", url: "/v1/vault", headers: user.headers })).json();
    expect(view.in_sync).toBe(true);
    expect(orders).toContain(payout.payout_id);

    const stored = await database.payout.findUniqueOrThrow({ where: { id: payout.payout_id } });
    expect(stored.routeKind).toBe("intents");
    expect((await pay(user.headers, `k-${suffix}-ok`, quoted.quote_id)).json()).toEqual(payout);
  }, 120_000);

  it("stops and returns a fresh quote when the hop costs more than 30 bps over what was quoted", async () => {
    reset();
    const user = await holder("guard", 100_000_000n);
    const quoted = await quote(user.headers);
    trouble.spike = true;
    const reply = await pay(user.headers, `k-${suffix}-guard`, quoted.quote_id);
    expect(reply.statusCode).toBe(409);
    expect(reply.json().error.code).toBe("quote_changed");
    expect(reply.json().quote.quote_id).not.toBe(quoted.quote_id);
    expect(reply.json().quote.routes[0].via_intents).toBe(true);

    const payout = await database.payout.findFirstOrThrow({ where: { quoteId: quoted.quote_id } });
    expect(payout).toMatchObject({ state: "failed", failureReason: "quote_changed" });
    expect(await vault.getReceipt(payout.id)).toBeNull();
    expect(await vault.getBalance(user.account)).toMatchObject({ available: 100_000_000n, reserved: 0n });
    expect(await unit((tx) => vaultMirror(tx, user.account, "USDC"))).toEqual({ available: 100_000_000n, reserved: 0n });
    expect((await pay(user.headers, `k-${suffix}-guard`, quoted.quote_id)).statusCode).toBe(409);
    reset();
  }, 120_000);

  it("fails cleanly with no funds moved when 1Click cannot quote after the provider order exists", async () => {
    reset();
    const user = await holder("outage", 100_000_000n);
    const quoted = await quote(user.headers);
    trouble.failQuote = true;
    const reply = await pay(user.headers, `k-${suffix}-outage`, quoted.quote_id);
    expect(reply.statusCode).toBe(422);
    expect(reply.json().error.code).toBe("route_unavailable");
    const payout = await database.payout.findFirstOrThrow({ where: { quoteId: quoted.quote_id } });
    expect(payout).toMatchObject({ state: "failed", failureReason: "route_unavailable" });
    expect(await vault.getBalance(user.account)).toMatchObject({ available: 100_000_000n, reserved: 0n });
    reset();
  }, 120_000);

  it("gives the reservation back when the vault refuses the order", async () => {
    reset();
    const user = await holder("refused", 100_000_000n);
    const quoted = await quote(user.headers);
    trouble.failRegister = true;
    const reply = await pay(user.headers, `k-${suffix}-refused`, quoted.quote_id);
    expect(reply.statusCode).toBe(422);
    expect(reply.json().error.code).toBe("route_unavailable");
    expect(await unit((tx) => vaultMirror(tx, user.account, "USDC"))).toEqual({ available: 100_000_000n, reserved: 0n });
    expect(await vault.getBalance(user.account)).toMatchObject({ available: 100_000_000n, reserved: 0n });
    reset();
  }, 120_000);

  it("refuses before any provider order exists when the vault cannot cover the payout", async () => {
    reset();
    const user = await holder("poor", 10_000_000n);
    const quoted = await quote(user.headers);
    const before = orders.length;
    const reply = await pay(user.headers, `k-${suffix}-poor`, quoted.quote_id);
    expect(reply.statusCode).toBe(422);
    expect(reply.json().error.code).toBe("insufficient_balance");
    expect(orders.length).toBe(before);
    expect(await vault.getBalance(user.account)).toMatchObject({ available: 10_000_000n, reserved: 0n });
  }, 60_000);

  it("needs a fliq name, because the vault holder is the sender", async () => {
    reset();
    const user = await holder("nameless", 0n, false);
    const quoted = await quote(user.headers);
    const reply = await pay(user.headers, `k-${suffix}-nameless`, quoted.quote_id);
    expect(reply.statusCode).toBe(400);
    expect(reply.json().error.code).toBe("invalid_request");
  }, 60_000);
});
