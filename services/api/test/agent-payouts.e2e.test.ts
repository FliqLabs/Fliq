import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { deserialize } from "borsh";
import { KeyPair, SCHEMA } from "near-api-js";
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
import { AgentClient } from "../apps/mcp/src/client.js";
import { createMcpHandler } from "../apps/mcp/src/server.js";
import { createOneClickClient, createOneClickMock } from "../packages/chains/oneclick/index.js";
import type { NearRpc, RelayerClient, RelayResponse } from "../packages/chains/near/index.js";
import { MockVault, VaultError } from "../packages/chains/vault/index.js";
import { DEFAULT_ROUTING_CONFIG, NO_SIGNALS } from "../packages/domain/routing.js";
import { postEntry } from "../packages/ledger/post.js";
import { vaultCredited } from "../packages/ledger/postings.js";
import type { CreateOrderRequest, ProviderAdapter } from "../packages/providers/types.js";

// Throwaway local database only; Prisma loads .env, which may point at a shared one.
const enabled = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") && Boolean(process.env.FLIQ_ACCESS_SECRET);
const USDC = "usdc.test.near";
const PAYCREST_ADDRESS = "0x76b4c56085ed136a8744d52be956396624a730e8";

describe.skipIf(!enabled)("an agent paying from its owner's vault through the MCP server", () => {
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

  // The relayer runs the agent's signed payout on the vault, as the chain would, so the vault's own cap check decides.
  const relayer: RelayerClient = {
    async relay(signed): Promise<RelayResponse> {
      const { delegateAction } = deserialize(SCHEMA.SignedDelegate, Buffer.from(signed, "base64")) as {
        delegateAction: { senderId: string; receiverId: string; actions: { functionCall: { methodName: string; args: Uint8Array } }[] };
      };
      const call = delegateAction.actions[0]?.functionCall;
      const args = JSON.parse(Buffer.from(call?.args ?? []).toString("utf8")) as { order_id: string };
      const base = { tx_hash: `tx-${randomBytes(4).toString("hex")}`, delegate_hash: randomBytes(32).toString("hex"), sender_id: delegateAction.senderId, receiver_id: delegateAction.receiverId };
      try {
        vault.payout(delegateAction.senderId, args.order_id);
        return { ...base, status: "succeeded", failures: [] };
      } catch (error) {
        return { ...base, status: "failed", failures: [error instanceof VaultError ? error.message : String(error)] };
      }
    },
    relayStatus: async () => {
      throw new Error("not used");
    },
    health: async () => ({ status: "ok" }),
    provisionAccount: async () => {
      throw new Error("not used");
    },
  };
  const rpc: NearRpc = {
    accessKey: async () => ({ nonce: 1n, permission: "FullAccess" }),
    account: async () => null,
    callView: async () => null,
    finalBlock: async () => ({ hash: "11111111111111111111111111111111", height: 5_000n }),
    sendTransaction: async () => {
      throw new Error("not used");
    },
    transactionStatus: async () => null,
  };

  let oneClick: Server;
  let api: string;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    const mock = createOneClickMock({ now: () => new Date() });
    oneClick = createServer((req, res) => void mock.handle(req, res));
    await new Promise<void>((resolve) => oneClick.listen(0, resolve));
    const client = createOneClickClient({ baseUrl: `http://127.0.0.1:${(oneClick.address() as AddressInfo).port}`, apiKey: undefined });
    const hops = new OneClickHops({ client, slippageBps: 10, pricingRefundTo: config.vaultAccount, pricingRecipient: PAYCREST_ADDRESS });
    const base = sandboxAdapters()[0] as ProviderAdapter;
    const paycrest: ProviderAdapter = {
      ...base,
      id: "paycrest",
      quote: async (request) => ({ ...(await base.quote(request)), provider: "paycrest" }),
      capabilities: () => ({ ...base.capabilities(), provider: "paycrest", sources: [{ asset: "USDC", chain: "base" }] }),
      async createOrder(request: CreateOrderRequest) {
        const created = await base.createOrder(request);
        return { ...created, funding: { kind: "deposit_address", chain: "base", asset: "USDC", address: PAYCREST_ADDRESS, units: request.quote.sendUnits, validUntil: new Date(Date.now() + 15 * 60_000) } };
      },
    };
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
        relayer,
        vault,
        quotes,
        payouts: {
          config,
          adapters: [paycrest],
          velocity: DEFAULT_VELOCITY,
          now: () => new Date(),
          intents: { hops, vault, tokenStorage: { ensure: async (account: string) => vault.registerStorage(account) }, guardBps: DEFAULT_GUARD_BPS, deadlineMarginMs: DEFAULT_DEADLINE_MARGIN_MS },
        },
      }),
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    api = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  }, 60_000);

  afterAll(async () => {
    oneClick.close();
    await app.close();
    await database.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      const users = await tx.user.findMany({ where: { email: { in: emails } }, select: { id: true, nearAccount: true } });
      const ids = users.map((user) => user.id);
      const accounts = users.flatMap((user) => (user.nearAccount ? [`%${user.nearAccount}%`] : []));
      await tx.$executeRaw`DELETE FROM ledger.journal_lines WHERE entry_id IN (SELECT id FROM ledger.journal_entries WHERE payout_id IN (SELECT id FROM core.payouts WHERE developer_id = ANY(${ids}::text[])) OR payout_id LIKE ${`%${suffix}%`})`;
      await tx.$executeRaw`DELETE FROM ledger.journal_entries WHERE payout_id IN (SELECT id FROM core.payouts WHERE developer_id = ANY(${ids}::text[])) OR payout_id LIKE ${`%${suffix}%`}`;
      await tx.$executeRaw`DELETE FROM ledger.balances WHERE account_id IN (SELECT id FROM ledger.accounts WHERE code LIKE ANY(${accounts}::text[]))`;
      await tx.$executeRaw`DELETE FROM ledger.accounts WHERE code LIKE ANY(${accounts}::text[])`;
      await tx.$executeRaw`DELETE FROM core.agent_refusals WHERE user_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM core.agents WHERE user_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM core.payout_events WHERE payout_id IN (SELECT id FROM core.payouts WHERE developer_id = ANY(${ids}::text[]))`;
      await tx.$executeRaw`DELETE FROM core.payouts WHERE developer_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM core.quote_routes WHERE quote_id IN (SELECT id FROM core.quotes WHERE developer_id = ANY(${ids}::text[]))`;
      await tx.$executeRaw`DELETE FROM core.quotes WHERE developer_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM core.recipients WHERE user_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM developer.idempotency_records WHERE scope = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.session_devices WHERE user_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.sessions WHERE user_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.users WHERE id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.email_links WHERE email = ANY(${emails}::text[])`;
    });
    await database.$disconnect();
  }, 60_000);

  // An owner with a funded vault, a saved account and an agent the vault already holds a policy for.
  async function ownerWithAgent(label: string, caps: { daily: string; perPayout: string } = { daily: "150000", perPayout: "50000" }) {
    const email = `agentpay+${label}-${suffix}@example.test`;
    emails.push(email);
    await app.inject({ method: "POST", url: "/v1/auth/email-links", payload: { email } });
    const token = new URL(links.at(-1) as string).searchParams.get("token") as string;
    const session = (await app.inject({ method: "POST", url: "/v1/auth/email-links/verify", payload: { token } })).json();
    const headers = { authorization: `Bearer ${session.access_token}` };
    const idem = () => ({ ...headers, "idempotency-key": `k-${randomBytes(6).toString("hex")}` });
    const name = `${label}-${suffix}`;
    const owner = (await app.inject({ method: "POST", url: "/v1/me/name", payload: { name }, headers: idem() })).json().near_account as string;
    vault.ftOnTransfer({ predecessor: USDC, senderId: owner, amount: 500_000_000n, msg: "" });
    await unit((tx) => postEntry(tx, vaultCredited(`fund-${label}-${suffix}`, owner, "USDC", 500_000_000n)));
    const recipient = (await app.inject({ method: "POST", url: "/v1/recipients", payload: { bank: "058", number: "0123456789" }, headers: idem() })).json();

    const key = KeyPair.fromRandom("ed25519");
    const connected = await app.inject({
      method: "POST",
      url: "/v1/agents",
      headers: idem(),
      payload: { name: "Claude", public_key: key.getPublicKey().toString(), daily_cap: { amount: caps.daily, currency: "NGN" }, per_payout_cap: { amount: caps.perPayout, currency: "NGN" }, currencies: ["NGN"], saved_accounts_only: true },
    });
    expect(connected.statusCode, connected.body).toBe(201);
    const { agent, steps } = connected.json();
    const args = steps[0].args;
    vault.setAgent(owner, agent.agent_id, { perPayoutCap: BigInt(args.per_payout_cap), dailyCap: BigInt(args.daily_cap), corridors: args.corridors });
    const client = new AgentClient({ apiUrl: api, agentId: agent.agent_id, privateKey: key.toString(), rpc });
    return { headers, owner, agentId: agent.agent_id as string, recipientId: recipient.recipient_id as string, client, mcp: createMcpHandler(client), key };
  }

  const call = async (mcp: ReturnType<typeof createMcpHandler>, name: string, args: Record<string, unknown> = {}) => {
    const response = await mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
    const result = response?.result as { content: { text: string }[]; isError: boolean };
    return { isError: result.isError, body: JSON.parse(result.content[0]?.text ?? "null") };
  };

  it("speaks MCP: initialize, then five fliq tools", async () => {
    const { mcp } = await ownerWithAgent("hello");
    const init = await mcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    expect(init?.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fliq" } });
    expect(await mcp({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    const list = await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect((list?.result as { tools: { name: string }[] }).tools.map((tool) => tool.name)).toEqual(["fliq_limits", "fliq_recipients", "fliq_quote", "fliq_pay", "fliq_payout_status"]);
    expect((await mcp({ jsonrpc: "2.0", id: 3, method: "nope" }))?.error?.code).toBe(-32601);
  });

  it("accepts only requests the agent itself signed, recently", async () => {
    const { agentId, key, client } = await ownerWithAgent("auth");
    expect((await client.request("GET", "/v1/agent")).status).toBe(200);
    expect((await fetch(`${api}/v1/agent`)).status).toBe(401);
    const stale = new AgentClient({ apiUrl: api, agentId, privateKey: key.toString(), rpc }, { now: () => Date.now() - 10 * 60_000 });
    expect((await stale.request("GET", "/v1/agent")).status).toBe(401);
    const impostor = new AgentClient({ apiUrl: api, agentId, privateKey: KeyPair.fromRandom("ed25519").toString(), rpc });
    expect((await impostor.request("GET", "/v1/agent")).status).toBe(401);
  });

  it("shows the agent its limits and the owner's saved accounts", async () => {
    const { mcp, owner, recipientId } = await ownerWithAgent("limits");
    const limits = await call(mcp, "fliq_limits");
    expect(limits).toMatchObject({ isError: false, body: { owner, state: "active", currencies: ["NGN"], saved_accounts_only: true, spent_today_usd: "0.00" } });
    const recipients = await call(mcp, "fliq_recipients");
    expect(recipients.body.items.map((item: { recipient_id: string }) => item.recipient_id)).toEqual([recipientId]);
  });

  it("pays a saved account within its limits, signs the vault payout itself, and shows as the agent's payout", async () => {
    const { mcp, headers, agentId, recipientId } = await ownerWithAgent("pay");
    const quote = await call(mcp, "fliq_quote", { currency: "ngn", amount: "10.00" });
    expect(quote.isError, JSON.stringify(quote.body)).toBe(false);
    const paid = await call(mcp, "fliq_pay", { quote_id: quote.body.quote_id, recipient_id: recipientId });
    expect(paid.isError, JSON.stringify(paid.body)).toBe(false);
    expect(paid.body.payout).toMatchObject({ state: "awaiting_deposit", agent: { agent_id: agentId, name: "Claude" } });
    expect(paid.body.relay).toMatchObject({ status: "succeeded", sender_id: agentId });
    expect((await vault.getReceipt(paid.body.payout_id))?.state).toBe("executed");

    const status = await call(mcp, "fliq_payout_status", { payout_id: paid.body.payout_id });
    expect(status.body.payout_id).toBe(paid.body.payout_id);
    expect((await call(mcp, "fliq_limits")).body.spent_today_usd).not.toBe("0.00");

    const byAgents = (await app.inject({ method: "GET", url: "/v1/activity?filter=agents", headers })).json().items;
    expect(byAgents[0]).toMatchObject({ kind: "payout", ref_id: paid.body.payout_id, agent: { agent_id: agentId } });
    expect((await app.inject({ method: "GET", url: "/v1/activity?filter=mine", headers })).json().items).toEqual([]);
  }, 60_000);

  it("refuses over the per-payout cap before anything is created, and tells the owner", async () => {
    const { mcp, headers, recipientId } = await ownerWithAgent("cap", { daily: "150000", perPayout: "1000" });
    const quote = await call(mcp, "fliq_quote", { currency: "ngn", amount: "10.00" });
    const refused = await call(mcp, "fliq_pay", { quote_id: quote.body.quote_id, recipient_id: recipientId });
    expect(refused).toMatchObject({ isError: true, body: { error: { code: "agent_limit" } } });
    const activity = (await app.inject({ method: "GET", url: "/v1/activity?filter=agents", headers })).json().items;
    expect(activity.map((item: { kind: string; reason: string }) => [item.kind, item.reason])).toEqual([["refused", "over_per_payout_cap"]]);
    expect((await app.inject({ method: "GET", url: "/v1/notifications", headers })).json().items[0].kind).toBe("agent_refused");
  }, 60_000);

  it("refuses an account that is not saved when the owner allows saved accounts only", async () => {
    const { client, headers } = await ownerWithAgent("saved");
    const quote = (await client.request("POST", "/v1/agent/quotes", { currency: "ngn", amount: "10.00" })).body as { quote_id: string };
    const refused = await client.request("POST", "/v1/agent/payouts", { quote_id: quote.quote_id, account: { bank: "058", number: "0123456789" } }, { "idempotency-key": `saved-${suffix}` });
    expect(refused).toMatchObject({ status: 422, body: { error: { code: "agent_limit" } } });
    expect((await app.inject({ method: "GET", url: "/v1/activity?filter=agents", headers })).json().items[0].reason).toBe("not_saved_account");
  }, 60_000);

  it("is stopped by the vault itself when the chain's daily cap is lower than the API knew", async () => {
    const { mcp, owner, agentId, recipientId, headers } = await ownerWithAgent("vault");
    const quote = await call(mcp, "fliq_quote", { currency: "ngn", amount: "10.00" });
    const created = await call(mcp, "fliq_limits");
    expect(created.isError).toBe(false);
    const tight = { perPayoutCap: 100_000_000n, dailyCap: 100_000_000n, corridors: null };
    vault.setAgent(owner, agentId, tight);
    const paid = await call(mcp, "fliq_pay", { quote_id: quote.body.quote_id, recipient_id: recipientId });
    expect(paid.body.relay.status).toBe("succeeded");
    vault.setAgent(owner, agentId, { ...tight, dailyCap: 1n, perPayoutCap: 1n });
    const second = await call(mcp, "fliq_quote", { currency: "ngn", amount: "10.00" });
    const refused = await call(mcp, "fliq_pay", { quote_id: second.body.quote_id, recipient_id: recipientId });
    expect(refused).toMatchObject({ isError: true, body: { error: { code: "agent_limit" } } });
    expect((await app.inject({ method: "GET", url: "/v1/activity?filter=agents", headers })).json().items.some((item: { kind: string }) => item.kind === "refused")).toBe(true);
  }, 60_000);

  it("lets an agent relay only what it signed, and stops it at the door once revoked", async () => {
    const { owner, agentId, client, headers } = await ownerWithAgent("revoked");
    const other = await ownerWithAgent("other");
    const theirs = await other.client.signAndRelay({ kind: "function_call", receiver_id: config.vaultAccount, method_name: "payout", args: { order_id: "po_x", amount: "1", deposit_address: "x.near" }, gas: "80000000000000", deposit: "0" });
    expect(theirs.status).toBe(200);
    const forged = await client.request("POST", "/v1/agent/relays", { signed_delegate: "AAAA" });
    expect(forged.status).toBe(400);
    expect((await client.request("GET", `/v1/agent/payouts/po_missing`)).status).toBe(404);

    expect((await app.inject({ method: "GET", url: "/v1/agents", headers })).json().agents[0].state).toBe("active");
    vault.removeAgent(owner, agentId);
    expect((await app.inject({ method: "GET", url: "/v1/agents", headers })).json().agents[0].state).toBe("revoked");
    expect((await client.request("GET", "/v1/agent")).status).toBe(401);
  }, 60_000);
});
