import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { KeyPair } from "near-api-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RelayerProvisioner } from "../apps/api/src/accounts.js";
import { buildApp } from "../apps/api/src/app.js";
import type { EmailSender } from "../apps/api/src/auth/email-links.js";
import { loadConfig } from "../apps/api/src/config.js";
import { createDatabase, unitOf } from "../apps/api/src/db.js";
import { createHandlers } from "../apps/api/src/handlers.js";
import { DEFAULT_VELOCITY } from "../apps/api/src/payouts.js";
import { delegateSender } from "../apps/api/src/relay.js";
import { sandboxAdapters } from "../apps/api/src/sandbox.js";
import { buildRelayerApp } from "../apps/relayer/src/app.js";
import { createRelayerClient, MemoryRelayStore, publicKeyOf, RelayerClientError, type RelayerClient } from "../packages/chains/near/index.js";
import { FakeNearRpc, newUser, RELAYER, relayerKeys, ROOT, signDelegate, USDC, VAULT } from "../packages/chains/near/near.fixtures.js";
import { MockVault } from "../packages/chains/vault/index.js";
import { Secret } from "../packages/config/index.js";
import { DEFAULT_ROUTING_CONFIG, NO_SIGNALS } from "../packages/domain/routing.js";

// Throwaway local database only; Prisma loads .env, which may point at a shared one.
const enabled = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") && Boolean(process.env.FLIQ_ACCESS_SECRET);
const TOKEN = "t".repeat(40);

describe.skipIf(!enabled)("creating NEAR accounts and relaying calls through the relayer", () => {
  if (!enabled) {
    it("needs DATABASE_URL pointing at a local database", () => {});
    return;
  }

  const database = createDatabase();
  const unit = unitOf(database);
  // The relayer's account creator is fliq.testnet, so names are claimed under it.
  const config = { ...loadConfig(), nearRootAccount: ROOT, vaultAccount: VAULT, usdcContract: USDC };
  const links: string[] = [];
  const sender: EmailSender = { sendSignInLink: async (_to, link) => void links.push(link) };
  const suffix = randomBytes(3).toString("hex");
  const emails: string[] = [];

  // The real relayer service, on a fake chain, reached over HTTP the way the API reaches it in production.
  const rpc = new FakeNearRpc();
  const keys = relayerKeys(5);
  for (const key of keys) rpc.addKey(RELAYER, publicKeyOf(key), { nonce: 1n, permission: "FullAccess" });
  const rootKey = KeyPair.fromRandom("ed25519");
  rpc.addKey(ROOT, rootKey.getPublicKey().toString());
  rpc.addAccount(USDC, true);
  const secret = new Secret(TOKEN);
  const relayerApp = buildRelayerApp({
    authToken: { current: secret, previous: undefined, accepts: (candidate) => secret.equals(candidate) },
    relay: { rpc, store: new MemoryRelayStore(), policy: { vaultContractId: VAULT, usdcContractId: USDC }, relayerAccountId: RELAYER, relayerKeys: keys, now: Date.now },
    provision: { rpc, store: new MemoryRelayStore(), root: { accountId: ROOT, privateKey: rootKey.toString() }, fundingYocto: 0n, storageContracts: [USDC, VAULT] },
  });

  const trouble = { pendingOnce: false, down: false, slowOnce: false };
  let real: RelayerClient;
  const relayer: RelayerClient = {
    relay: (signed) => real.relay(signed),
    relayStatus: (hash) => real.relayStatus(hash),
    health: () => real.health(),
    fundAgentDeposit: (accountId, agentId) => real.fundAgentDeposit(accountId, agentId),
    async provisionAccount(accountId, publicKey, options) {
      if (trouble.slowOnce) {
        trouble.slowOnce = false;
        await real.provisionAccount(accountId, publicKey, options);
        throw new RelayerClientError(0, "relayer_timeout", "the relayer did not answer in time");
      }
      if (trouble.down) return createRelayerClient({ url: "http://127.0.0.1:1", authToken: TOKEN }).provisionAccount(accountId, publicKey);
      if (trouble.pendingOnce) {
        trouble.pendingOnce = false;
        return { status: "pending", account_id: accountId, public_key: publicKey, tx_hashes: [], storage: {} };
      }
      return real.provisionAccount(accountId, publicKey, options);
    },
  };

  const adapters = sandboxAdapters();
  const app = buildApp({
    config,
    unit,
    logger: Boolean(process.env.E2E_LOG),
    handlers: createHandlers({
      config,
      unit,
      email: sender,
      provisioner: new RelayerProvisioner(relayer, VAULT),
      relayer,
      vault: new MockVault({ registrar: "registrar.test.near", usdc: USDC, now: () => 0n }),
      quotes: { adapters, routing: DEFAULT_ROUTING_CONFIG, signals: NO_SIGNALS, now: () => new Date() },
      payouts: { config, adapters, velocity: DEFAULT_VELOCITY, now: () => new Date() },
    }),
  });

  beforeAll(async () => {
    await relayerApp.listen({ port: 0, host: "127.0.0.1" });
    real = createRelayerClient({ url: `http://127.0.0.1:${(relayerApp.server.address() as AddressInfo).port}`, authToken: TOKEN });
    await app.ready();
  });

  afterAll(async () => {
    await relayerApp.close();
    await database.$transaction(async (tx) => {
      const users = await tx.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
      const ids = users.map((user) => user.id);
      await tx.$executeRaw`DELETE FROM core.agents WHERE user_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM core.vault_deposits WHERE user_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM developer.idempotency_records WHERE scope = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.sessions WHERE user_id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.users WHERE id = ANY(${ids}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.email_links WHERE email = ANY(${emails}::text[])`;
    });
    await database.$disconnect();
  });

  async function signIn(label: string) {
    const email = `relayer+${label}-${suffix}@example.test`;
    emails.push(email);
    await app.inject({ method: "POST", url: "/v1/auth/email-links", payload: { email } });
    const token = new URL(links.at(-1) as string).searchParams.get("token") as string;
    const session = (await app.inject({ method: "POST", url: "/v1/auth/email-links/verify", payload: { token } })).json();
    return { authorization: `Bearer ${session.access_token}` };
  }

  const claim = (headers: Record<string, string>, key: string, payload: Record<string, string>) =>
    app.inject({ method: "POST", url: "/v1/me/name", payload, headers: { ...headers, "idempotency-key": key } });

  it("creates the NEAR account on chain, owned by the user's own key, and answers a replay the same way", async () => {
    const headers = await signIn("create");
    const user = newUser(`create${suffix}.${ROOT}`);
    const claimed = await claim(headers, `c-${suffix}`, { name: `create${suffix}`, public_key: user.publicKey });
    expect(claimed.statusCode, claimed.body).toBe(201);
    expect(claimed.json()).toMatchObject({ near_account: user.accountId, vault: VAULT });
    expect(await rpc.accessKey(user.accountId, user.publicKey)).toMatchObject({ permission: "FullAccess" });

    const replay = await claim(headers, `c-${suffix}`, { name: `create${suffix}`, public_key: user.publicKey });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(claimed.json());
  });

  it("tops the owner up once so they can attach set_agent's deposit, however often the agent is connected", async () => {
    const headers = await signIn("agent");
    const user = newUser(`agent${suffix}.${ROOT}`);
    expect((await claim(headers, `a-${suffix}`, { name: `agent${suffix}`, public_key: user.publicKey })).statusCode).toBe(201);
    // A fresh account on chain holds 1 yoctoNEAR; the fake chain starts accounts rich.
    rpc.setAmount(user.accountId, 1n);
    const input = { name: "Claude", public_key: newUser("agent key").publicKey, daily_cap: { amount: "150000", currency: "NGN" }, per_payout_cap: { amount: "50000", currency: "NGN" }, currencies: ["NGN"], saved_accounts_only: true };
    const connect = () => app.inject({ method: "POST", url: "/v1/agents", payload: input, headers: { ...headers, "idempotency-key": randomBytes(8).toString("hex") } });
    const toOwner = () => rpc.sent.filter((tx) => tx.receiverId === user.accountId && tx.actionKinds.join() === "transfer");

    const before = rpc.sent.length;
    const first = await connect();
    expect(first.statusCode, first.body).toBe(201);
    // The agent's account only signs, so connecting costs two transactions: its account and the owner's top-up.
    expect(rpc.sent.slice(before).map((tx) => tx.actionKinds.join())).toEqual(["createAccount,addKey", "transfer"]);
    expect(toOwner()).toHaveLength(1);
    expect(toOwner()[0]).toMatchObject({ signerId: ROOT });
    const owner = await rpc.account(user.accountId);
    expect(owner!.amount - BigInt(owner!.storageUsage) * 10n ** 19n).toBeGreaterThanOrEqual(BigInt(first.json().steps[0].deposit));

    expect((await connect()).statusCode).toBe(201);
    expect(toOwner()).toHaveLength(1);
  });

  it("asks for the key, and refuses one that is not ed25519", async () => {
    const headers = await signIn("nokey");
    expect((await claim(headers, `n-${suffix}`, { name: `nokey${suffix}` })).statusCode).toBe(400);
    const bad = await claim(headers, `b-${suffix}`, { name: `nokey${suffix}`, public_key: "secp256k1:abc" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toContain("ed25519");
  });

  it("answers 202 while the account is still being made, and finishes it when the same request comes again", async () => {
    const headers = await signIn("pending");
    const user = newUser(`pending${suffix}.${ROOT}`);
    const payload = { name: `pending${suffix}`, public_key: user.publicKey };
    trouble.pendingOnce = true;
    const first = await claim(headers, `p-${suffix}`, payload);
    expect(first.statusCode).toBe(202);
    expect(first.json()).toEqual({ status: "pending", near_account: user.accountId });
    expect((await app.inject({ method: "GET", url: "/v1/me", headers })).json().near_account ?? null).toBeNull();

    const second = await claim(headers, `p-${suffix}`, payload);
    expect(second.statusCode, second.body).toBe(201);
    expect(second.json().near_account).toBe(user.accountId);
  });

  it("answers 202 when the relayer is too slow, and the retry links the account it made meanwhile", async () => {
    const headers = await signIn("slow");
    const user = newUser(`slow${suffix}.${ROOT}`);
    trouble.slowOnce = true;
    const first = await claim(headers, `s-${suffix}`, { name: `slow${suffix}`, public_key: user.publicKey });
    expect(first.statusCode).toBe(202);
    const again = await claim(headers, `s-${suffix}`, { name: `slow${suffix}`, public_key: user.publicKey });
    expect(again.statusCode).toBe(201);
    expect(again.json().near_account).toBe(`slow${suffix}.${ROOT}`);
  });

  it("refuses a name whose NEAR account another key already controls, and says when the relayer is down", async () => {
    const owner = newUser(`owned${suffix}.${ROOT}`);
    rpc.addKey(owner.accountId, owner.publicKey);
    const headers = await signIn("taken");
    const taken = await claim(headers, `t-${suffix}`, { name: `owned${suffix}`, public_key: newUser("x").publicKey });
    expect(taken.statusCode, taken.body).toBe(409);

    trouble.down = true;
    try {
      const down = await claim(headers, `d-${suffix}`, { name: `down${suffix}`, public_key: newUser("y").publicKey });
      expect(down.statusCode).toBe(503);
      expect(down.json().error.code).toBe("chain_unavailable");
    } finally {
      trouble.down = false;
    }
  });

  it("relays a call the user signed, only for the user's own account, and lets them read its outcome", async () => {
    const headers = await signIn("relay");
    const user = newUser(`relay${suffix}.${ROOT}`);
    expect((await claim(headers, `r-${suffix}`, { name: `relay${suffix}`, public_key: user.publicKey })).statusCode).toBe(201);

    const mine = await signDelegate(user, { methodName: "release_order", args: { order_id: "po_1" } });
    expect(delegateSender(mine.base64)).toBe(user.accountId);
    const relayed = await app.inject({ method: "POST", url: "/v1/relays", payload: { signed_delegate: mine.base64 }, headers });
    expect([200, 202]).toContain(relayed.statusCode);
    const result = relayed.json();
    expect(result).toMatchObject({ sender_id: user.accountId, receiver_id: VAULT });

    const read = await app.inject({ method: "GET", url: `/v1/relays/${result.delegate_hash}`, headers });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json().delegate_hash).toBe(result.delegate_hash);

    const stranger = await signIn("stranger");
    expect((await app.inject({ method: "GET", url: `/v1/relays/${result.delegate_hash}`, headers: stranger })).statusCode).toBe(404);

    const someoneElse = await signDelegate(newUser(`other${suffix}.${ROOT}`));
    const refused = await app.inject({ method: "POST", url: "/v1/relays", payload: { signed_delegate: someoneElse.base64 }, headers });
    expect(refused.statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/relays", payload: { signed_delegate: "bm90IGEgZGVsZWdhdGU=" }, headers })).statusCode).toBe(400);
  });

  it("shows USDC the user adds from their own NEAR account in Activity, once however often it is relayed", async () => {
    const headers = await signIn("topup");
    const user = newUser(`topup${suffix}.${ROOT}`);
    expect((await claim(headers, `t-${suffix}`, { name: `topup${suffix}`, public_key: user.publicKey })).statusCode).toBe(201);

    const topUp = await signDelegate(user, {
      receiverId: USDC,
      methodName: "ft_transfer_call",
      args: { receiver_id: VAULT, amount: "20000000", msg: "" },
      deposit: 1n,
    });
    const relayed = await app.inject({ method: "POST", url: "/v1/relays", payload: { signed_delegate: topUp.base64 }, headers });
    expect(relayed.statusCode, relayed.body).toBe(200);
    expect(relayed.json().status).toBe("succeeded");
    await app.inject({ method: "POST", url: "/v1/relays", payload: { signed_delegate: topUp.base64 }, headers });

    const activity = (await app.inject({ method: "GET", url: "/v1/activity", headers })).json();
    const deposits = activity.items.filter((item: { kind: string }) => item.kind === "deposit");
    expect(deposits).toHaveLength(1);
    expect(deposits[0]).toMatchObject({ status: "received", usd: "20.00", token: "20 USDC", party: { name: "Received from NEAR" } });
  });

  it("passes the relayer's own refusals through, such as a call outside its allowlist", async () => {
    const headers = await signIn("allow");
    const user = newUser(`allow${suffix}.${ROOT}`);
    await claim(headers, `a-${suffix}`, { name: `allow${suffix}`, public_key: user.publicKey });
    const outside = await signDelegate(user, { receiverId: "evil.testnet" });
    const reply = await app.inject({ method: "POST", url: "/v1/relays", payload: { signed_delegate: outside.base64 }, headers });
    expect(reply.statusCode).toBe(403);
    expect(reply.json().error.code).toBe("not_allowed");
  });
});
