import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockProvisioner } from "../apps/api/src/accounts.js";
import { buildApp } from "../apps/api/src/app.js";
import type { EmailSender } from "../apps/api/src/auth/email-links.js";
import { loadConfig } from "../apps/api/src/config.js";
import { createDatabase, unitOf } from "../apps/api/src/db.js";
import { encrypt, keyedHash } from "../packages/db/src/crypto.js";
import { createDeposits } from "../apps/api/src/deposits.js";
import { createHandlers } from "../apps/api/src/handlers.js";
import { DEFAULT_VELOCITY } from "../apps/api/src/payouts.js";
import { sandboxAdapters } from "../apps/api/src/sandbox.js";
import { createOneClickClient, createOneClickMock } from "../packages/chains/oneclick/index.js";
import type { RelayerClient, RelayResponse } from "../packages/chains/near/index.js";
import { newUser, signDelegate } from "../packages/chains/near/near.fixtures.js";
import { MockVault } from "../packages/chains/vault/index.js";
import { DEFAULT_ROUTING_CONFIG, NO_SIGNALS } from "../packages/domain/routing.js";
import { postEntry } from "../packages/ledger/post.js";
import { vaultCredited } from "../packages/ledger/postings.js";

// Throwaway local database only; Prisma loads .env, which may point at a shared one.
const enabled = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") && Boolean(process.env.FLIQ_ACCESS_SECRET);
const USDC = "usdc.test.near";

describe.skipIf(!enabled)("the app's activity, agents, requests and settings", () => {
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

  // The relayer answers what each test scripts, the way the real one answers after the chain ran the delegate.
  const relayed: string[] = [];
  let nextRelay: (delegate: string) => RelayResponse = () => {
    throw new Error("no relay scripted");
  };
  const relayer: RelayerClient = {
    async relay(delegate) {
      relayed.push(delegate);
      return nextRelay(delegate);
    },
    relayStatus: async () => {
      throw new Error("not used");
    },
    health: async () => ({ status: "ok" }),
    provisionAccount: async () => {
      throw new Error("not used");
    },
    fundAgentDeposit: async () => {
      throw new Error("not used");
    },
  };

  let server: Server;
  let mockUrl: string;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    const mock = createOneClickMock({ now: () => new Date(), processingAfterMs: 100, settleAfterMs: 300 });
    server = createServer((req, res) => void mock.handle(req, res));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    mockUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const deposits = createDeposits({
      client: createOneClickClient({ baseUrl: mockUrl, apiKey: undefined }),
      vaultAccount: config.vaultAccount,
      usdcContract: USDC,
      slippageBps: 200,
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
        relayer,
        vault,
        deposits,
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
      const users = await tx.user.findMany({ where: { email: { in: emails } }, select: { id: true, nearAccount: true } });
      const ids = users.map((user) => user.id);
      const accounts = users.flatMap((user) => (user.nearAccount ? [user.nearAccount] : []));
      await tx.$executeRaw`DELETE FROM ledger.journal_lines WHERE entry_id IN (SELECT id FROM ledger.journal_entries WHERE payout_id IN (SELECT id FROM core.payouts WHERE developer_id = ANY(${ids}::text[])) OR payout_id IN (SELECT id FROM core.vault_deposits WHERE user_id = ANY(${ids}::text[])) OR payout_id IN (SELECT id FROM core.transfers WHERE from_user_id = ANY(${ids}::text[])) OR payout_id LIKE ${`%${suffix}%`})`;
      await tx.$executeRaw`DELETE FROM ledger.journal_entries WHERE payout_id IN (SELECT id FROM core.payouts WHERE developer_id = ANY(${ids}::text[])) OR payout_id IN (SELECT id FROM core.vault_deposits WHERE user_id = ANY(${ids}::text[])) OR payout_id IN (SELECT id FROM core.transfers WHERE from_user_id = ANY(${ids}::text[])) OR payout_id LIKE ${`%${suffix}%`}`;
      await tx.$executeRaw`DELETE FROM ledger.balances WHERE account_id IN (SELECT id FROM ledger.accounts WHERE code LIKE ANY(${accounts.map((account) => `%${account}%`)}::text[]))`;
      await tx.$executeRaw`DELETE FROM ledger.accounts WHERE code LIKE ANY(${accounts.map((account) => `%${account}%`)}::text[])`;
      await tx.$executeRaw`DELETE FROM core.agent_refusals WHERE user_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM core.agents WHERE user_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM core.payment_requests WHERE user_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM core.transfers WHERE from_user_id = ANY(${ids}::text[]) OR to_user_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM core.vault_deposits WHERE user_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM core.payout_events WHERE payout_id IN (SELECT id FROM core.payouts WHERE developer_id = ANY(${ids}::text[]))`;
      await tx.$executeRaw`DELETE FROM core.payouts WHERE developer_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM core.quote_routes WHERE quote_id IN (SELECT id FROM core.quotes WHERE developer_id = ANY(${ids}::text[]))`;
      await tx.$executeRaw`DELETE FROM core.quotes WHERE developer_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM core.recipients WHERE user_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM developer.idempotency_records WHERE scope = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.session_devices WHERE user_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.push_tokens WHERE user_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.sessions WHERE user_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.users WHERE id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.email_links WHERE email = ANY(${emails}::text[])`;
    });
    await database.$disconnect();
  }, 60_000);

  async function signIn(email: string, device: string) {
    await app.inject({ method: "POST", url: "/v1/auth/email-links", payload: { email } });
    const token = new URL(links.at(-1) as string).searchParams.get("token") as string;
    const session = (await app.inject({ method: "POST", url: "/v1/auth/email-links/verify", payload: { token }, headers: { "x-device-name": device } })).json();
    return { headers: { authorization: `Bearer ${session.access_token}` }, refresh: session.refresh_token as string };
  }

  async function holder(label: string) {
    const email = `screens+${label}-${suffix}@example.test`;
    emails.push(email);
    const { headers } = await signIn(email, "iPhone 17 Pro");
    const name = `${label}-${suffix}`;
    const account = (await app.inject({ method: "POST", url: "/v1/me/name", payload: { name }, headers: { ...headers, "idempotency-key": `claim-${name}` } })).json().near_account as string;
    return { headers, account, email, name };
  }

  const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: "GET", url, headers });
  const send = (method: "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload: unknown, headers: Record<string, string>) =>
    app.inject({ method, url, payload: payload as object, headers: { ...headers, "idempotency-key": `k-${randomBytes(6).toString("hex")}` } });
  const fund = async (account: string, units: bigint) => {
    vault.ftOnTransfer({ predecessor: USDC, senderId: account, amount: units, msg: "" });
    await unit((tx) => postEntry(tx, vaultCredited(`fund-${account}-${suffix}`, account, "USDC", units)));
  };
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  async function landDeposit(headers: Record<string, string>, deposit: { deposit_id: string; address: string }, units: bigint, url = `/v1/deposits/${deposit.deposit_id}`) {
    await fetch(`${mockUrl}/mock/deposit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ depositAddress: deposit.address, amount: units.toString() }) });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await pause(3_100);
      const view = (await get(url, headers)).json();
      if (view.state === "landed") return view;
    }
    throw new Error("deposit never landed");
  }

  it("keeps the home currency, says the user is verified and refuses an unknown currency", async () => {
    const frank = await holder("profile");
    expect((await get("/v1/me", frank.headers)).json()).toMatchObject({ home_currency: "NGN", verified: true, daily_limit: { currency: "USD" } });
    expect((await send("PATCH", "/v1/me", { home_currency: "KES" }, frank.headers)).json().home_currency).toBe("KES");
    expect((await send("PATCH", "/v1/me", { home_currency: "USD" }, frank.headers)).statusCode).toBe(400);
  });

  it("marks the user's own account, keeps one default, and counts it toward getting started", async () => {
    const frank = await holder("accounts");
    expect((await get("/v1/me/setup", frank.headers)).json()).toMatchObject({ done: 0, total: 2 });
    const first = (await send("POST", "/v1/recipients", { bank: "058", number: "0123456789" }, frank.headers)).json();
    const userId = (await get("/v1/me", frank.headers)).json().user_id as string;
    const secondId = `rcp_second_${suffix}`;
    await unit((tx) =>
      tx.recipient.create({
        data: { id: secondId, userId, institutionCode: "044", accountCipher: encrypt("0987654321", config.dataKey), nameCipher: encrypt("EMEKA STUDIOS LTD", config.dataKey), lookupHash: keyedHash(`044:0987654321:${suffix}`, config.hashKey), savedAt: new Date() },
      }),
    );
    const second = { recipient_id: secondId };
    expect((await send("PATCH", `/v1/recipients/${first.recipient_id}`, { own: true, default: true }, frank.headers)).json()).toMatchObject({ own: true, default: true });
    await send("PATCH", `/v1/recipients/${second.recipient_id}`, { default: true }, frank.headers);
    const { items } = (await get("/v1/recipients", frank.headers)).json();
    expect(items[0]).toMatchObject({ recipient_id: first.recipient_id, own: true, default: false });
    expect(items.filter((item: { default: boolean }) => item.default).map((item: { recipient_id: string }) => item.recipient_id)).toEqual([second.recipient_id]);
    expect((await get("/v1/me/setup", frank.headers)).json()).toMatchObject({ steps: [{ step: "add_account", done: true }, { step: "top_up", done: false }], done: 1 });
    expect((await send("PATCH", "/v1/recipients/rcp_missing", { own: true }, frank.headers)).statusCode).toBe(404);
  });

  it("starts with every money and agent notification on, and only takes a rate alert with a rate", async () => {
    const frank = await holder("alerts");
    const defaults = (await get("/v1/me/notification-settings", frank.headers)).json();
    expect(defaults).toMatchObject({ received: true, agent_refused: true, weekly_summary: false, rate_alert: { enabled: false } });
    const broken = { ...defaults, rate_alert: { enabled: true, currency: "NGN", above: null } };
    expect((await send("PUT", "/v1/me/notification-settings", broken, frank.headers)).statusCode).toBe(400);
    const chosen = { ...defaults, weekly_summary: true, rate_alert: { enabled: true, currency: "NGN", above: 1400 } };
    expect((await send("PUT", "/v1/me/notification-settings", chosen, frank.headers)).json()).toEqual(chosen);
    expect((await get("/v1/me/notification-settings", frank.headers)).json()).toEqual(chosen);
    expect((await send("POST", "/v1/devices/push", { token: `apns-${suffix}`, platform: "ios" }, frank.headers)).statusCode).toBe(204);
  });

  it("names each signed-in device, lists the current one first, and signs another out", async () => {
    const frank = await holder("devices");
    const laptop = await signIn(frank.email, "MacBook Pro · Safari");
    const { items } = (await get("/v1/sessions", frank.headers)).json();
    expect(items.map((item: { device: string }) => item.device)).toEqual(["iPhone 17 Pro", "MacBook Pro · Safari"]);
    expect(items[0].current).toBe(true);
    expect((await send("DELETE", `/v1/sessions/${items[1].session_id}`, undefined, frank.headers)).statusCode).toBe(204);
    expect((await get("/v1/me", laptop.headers)).statusCode).toBe(401);
    expect((await get("/v1/me", frank.headers)).statusCode).toBe(200);
    expect((await get("/v1/passkeys", frank.headers)).json()).toEqual({ items: [] });
  });

  it("shows payouts, top-ups and transfers in one list, newest first, page by page, with notifications", async () => {
    const frank = await holder("activity");
    const tobi = await holder("tobi");
    await fund(frank.account, 100_000_000n);

    const quote = (await send("POST", "/v1/quotes", { token: "usdc", currency: "ngn", amount: "50.00", source_chain: "base" }, frank.headers)).json();
    const payout = (await send("POST", "/v1/payouts", { quote_id: quote.quote_id, account: { bank: "058", number: "0123456789" }, refund_address: frank.account }, frank.headers)).json();

    const deposit = (await send("POST", "/v1/deposits", { token: "usdc", chain: "solana", amount: "20" }, frank.headers)).json();
    await landDeposit(frank.headers, deposit, 20_000_000n);

    const pay = await signDelegate({ ...newUser(frank.account), accountId: frank.account }, { receiverId: config.vaultAccount, methodName: "transfer", deposit: 1n, args: { to_account: tobi.account, amount: "5000000" } });
    nextRelay = () => ({ status: "succeeded", tx_hash: `tx-transfer-${suffix}`, delegate_hash: "d1", sender_id: frank.account, receiver_id: config.vaultAccount, failures: [] });
    expect((await send("POST", "/v1/relays", { signed_delegate: pay.base64 }, frank.headers)).statusCode).toBe(200);

    const all = (await get("/v1/activity", frank.headers)).json().items;
    expect(all.map((item: { kind: string }) => item.kind)).toEqual(["transfer_out", "deposit", "payout"]);
    expect(all[0]).toMatchObject({ status: "sent", usd: "5.00", party: { near_account: tobi.account } });
    expect(all[1]).toMatchObject({ status: "received", party: { name: "Received from Solana" }, token: "20 USDC" });
    expect(all[2]).toMatchObject({ ref_id: payout.payout_id, provider: payout.provider, party: { account_last4: "6789" }, local: { currency: "NGN" } });
    expect((await get("/v1/activity", tobi.headers)).json().items[0]).toMatchObject({ kind: "transfer_in", status: "received", party: { near_account: frank.account } });

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { items: { activity_id: string }[]; next_cursor: string | null } = (await get(`/v1/activity?limit=1${cursor ? `&cursor=${cursor}` : ""}`, frank.headers)).json();
      seen.push(...page.items.map((item: { activity_id: string }) => item.activity_id));
      cursor = page.next_cursor;
    } while (cursor);
    expect(seen).toEqual(all.map((item: { activity_id: string }) => item.activity_id));
    expect((await get("/v1/activity?filter=agents", frank.headers)).json().items).toEqual([]);
    expect((await get("/v1/activity?filter=everything", frank.headers)).statusCode).toBe(400);

    const notifications = (await get("/v1/notifications", frank.headers)).json().items;
    expect(notifications.map((item: { kind: string }) => item.kind)).toEqual(["received"]);
    expect(notifications[0].body).toContain("from Solana is in your vault");
    expect((await get("/v1/notifications", tobi.headers)).json().items[0]).toMatchObject({ kind: "received", title: "Received" });
  }, 90_000);

  it("shows a payout's public receipt to anyone, with the account holder masked", async () => {
    const frank = await holder("receipt");
    const quote = (await send("POST", "/v1/quotes", { token: "usdc", currency: "ngn", amount: "50.00", source_chain: "base" }, frank.headers)).json();
    const payout = (await send("POST", "/v1/payouts", { quote_id: quote.quote_id, account: { bank: "058", number: "0123456789" }, refund_address: frank.account }, frank.headers)).json();
    const receipt = await get(`/v1/receipts/${payout.payout_id}`);
    expect(receipt.statusCode, receipt.body).toBe(200);
    expect(receipt.json()).toMatchObject({ payout_id: payout.payout_id, account_masked: "D*** O*** ···6789", institution: "058" });
    expect(receipt.body).not.toContain("DARA");
    expect(receipt.body).not.toContain("0123456789");
    expect((await get("/v1/receipts/po_missing")).statusCode).toBe(404);
  });

  it("asks to be paid with a link anyone can pay from another chain, and marks the request paid when it lands", async () => {
    const frank = await holder("request");
    const created = await send("POST", "/v1/requests", { amount: "12.00", note: "Brand film, October", cash_out_on_arrival: false }, frank.headers);
    expect(created.statusCode, created.body).toBe(201);
    const request = created.json();
    expect(request).toMatchObject({ state: "open", amount: "12.00", link: `${config.payLinkBase}/${frank.name}/${request.code}`, paid: null });
    expect((await send("POST", "/v1/requests", { amount: "0", note: "x", cash_out_on_arrival: false }, frank.headers)).statusCode).toBe(400);

    const page = await get(`/v1/pay/${frank.name}/${request.code}`);
    expect(page.statusCode, page.body).toBe(200);
    expect(page.json()).toMatchObject({ near_account: frank.account, amount: "12.00", note: "Brand film, October", state: "open" });
    expect(page.json().sources.every((source: { token: string }) => source.token !== "btc")).toBe(true);
    expect((await get(`/v1/pay/${frank.name}/ffff`)).statusCode).toBe(404);

    const reserve = () => app.inject({ method: "POST", url: `/v1/pay/${frank.name}/${request.code}/deposits`, payload: { token: "usdc", chain: "base" } });
    const deposit = (await reserve()).json();
    expect(deposit).toMatchObject({ state: "waiting", amount: "12.00" });
    expect((await reserve()).json().deposit_id).toBe(deposit.deposit_id);
    expect((await app.inject({ method: "POST", url: `/v1/pay/${frank.name}/${request.code}/deposits`, payload: { token: "btc", chain: "bitcoin" } })).statusCode).toBe(400);

    await landDeposit({}, deposit, 12_000_000n, `/v1/pay/${frank.name}/${request.code}/deposits/${deposit.deposit_id}`);
    const paid = (await get(`/v1/requests/${request.request_id}`, frank.headers)).json();
    expect(paid).toMatchObject({ state: "paid", paid: { token: "USDC", chain: "base", amount: "12.00", deposit_id: deposit.deposit_id } });
    expect((await send("DELETE", `/v1/requests/${request.request_id}`, undefined, frank.headers)).statusCode).toBe(409);
    expect((await reserve()).statusCode).toBe(409);

    const other = (await send("POST", "/v1/requests", { amount: "5.00", note: "Studio rent, Nov", cash_out_on_arrival: true }, frank.headers)).json();
    expect((await send("DELETE", `/v1/requests/${other.request_id}`, undefined, frank.headers)).json().state).toBe("cancelled");
    expect((await get("/v1/requests", frank.headers)).json().items.map((item: { state: string }) => item.state)).toEqual(["cancelled", "paid"]);
  }, 90_000);

  it("connects an agent with caps in naira, shows it active once the vault holds its policy, and revokes it", async () => {
    const frank = await holder("agents");
    const agentKey = newUser("agent").publicKey;
    const input = { name: "Claude", public_key: agentKey, daily_cap: { amount: "150000", currency: "NGN" }, per_payout_cap: { amount: "50000", currency: "NGN" }, currencies: ["NGN"], saved_accounts_only: true };
    const connected = await send("POST", "/v1/agents", input, frank.headers);
    expect(connected.statusCode, connected.body).toBe(201);
    const { agent, steps } = connected.json();
    expect(agent).toMatchObject({ agent_id: `claude-${frank.name}.${config.nearRootAccount}`, state: "pending", daily_cap: { amount: "150000", currency: "NGN" } });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: "function_call", receiver_id: config.vaultAccount, method_name: "set_agent", deposit: "10000000000000000000000" });
    const args = steps[0].args;
    expect(args).toMatchObject({ public_key: agentKey, agent_id: agent.agent_id, corridors: ["NG-NGN-bank", "NG-NGN-mobile_money"], cooldown_ns: "0" });
    expect(BigInt(args.per_payout_cap)).toBeLessThan(BigInt(args.daily_cap));
    expect(BigInt(args.daily_cap)).toBeGreaterThan(0n);

    expect((await send("POST", "/v1/agents", { ...input, public_key: newUser("other").publicKey }, frank.headers)).statusCode).toBe(409);
    expect((await get("/v1/agents", frank.headers)).json().agents[0].state).toBe("pending");

    vault.setAgent(frank.account, agent.agent_id, { perPayoutCap: BigInt(args.per_payout_cap), dailyCap: BigInt(args.daily_cap), corridors: args.corridors });
    expect((await get("/v1/agents", frank.headers)).json().agents[0]).toMatchObject({ state: "active", spent_today: { amount: "0", currency: "NGN" } });

    const limits = await send("PATCH", `/v1/agents/${agent.agent_id}`, { daily_cap: { amount: "100000", currency: "NGN" }, per_payout_cap: { amount: "20000", currency: "NGN" }, currencies: ["NGN", "KES"], saved_accounts_only: false }, frank.headers);
    expect(limits.json().agent).toMatchObject({ daily_cap: { amount: "100000" }, currencies: ["NGN", "KES"] });
    expect(limits.json().steps[0].args.corridors).toEqual(["NG-NGN-bank", "NG-NGN-mobile_money", "KE-KES-mobile_money", "KE-KES-bank"]);

    const revoke = (await send("DELETE", `/v1/agents/${agent.agent_id}`, undefined, frank.headers)).json();
    expect(revoke.steps[0]).toMatchObject({ method_name: "remove_agent", args: { agent_id: agent.agent_id }, deposit: "1" });
    vault.removeAgent(frank.account, agent.agent_id);
    expect((await get("/v1/agents", frank.headers)).json().agents[0].state).toBe("revoked");
  }, 60_000);

  it("records an agent payout the vault refused, under the Agents filter only", async () => {
    const frank = await holder("refusal");
    const agentKey = newUser("agent").publicKey;
    const { agent } = (await send("POST", "/v1/agents", { name: "Claude", public_key: agentKey, daily_cap: { amount: "150000", currency: "NGN" }, per_payout_cap: { amount: "50000", currency: "NGN" }, currencies: ["NGN"], saved_accounts_only: true }, frank.headers)).json();
    const delegate = await signDelegate({ ...newUser(agent.agent_id), accountId: agent.agent_id }, { receiverId: config.vaultAccount, methodName: "payout", args: { order_id: "po_none", amount: "1000000", deposit_address: "pay.paycrest.testnet" } });
    nextRelay = () => ({ status: "failed", tx_hash: `tx-refused-${suffix}`, delegate_hash: "d2", sender_id: agent.agent_id, receiver_id: config.vaultAccount, failures: ['{"ExecutionError":"Smart contract panicked: fliq_vault: POLICY_DAILY_CAP"}'] });
    expect((await send("POST", "/v1/relays", { signed_delegate: delegate.base64 }, frank.headers)).json().status).toBe("failed");

    const refused = (await get("/v1/activity?filter=agents", frank.headers)).json().items;
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ kind: "refused", status: "refused", reason: "over_daily_cap", agent: { agent_id: agent.agent_id, name: "Claude" } });
    expect((await get("/v1/activity?filter=mine", frank.headers)).json().items).toEqual([]);
    expect((await get("/v1/notifications", frank.headers)).json().items[0]).toMatchObject({ kind: "agent_refused", title: "Refused: Claude was refused" });

    const stranger = await signDelegate(newUser(`someone-${suffix}.near`));
    expect((await send("POST", "/v1/relays", { signed_delegate: stranger.base64 }, frank.headers)).statusCode).toBe(403);
  });
});
