import { KeyPair } from "near-api-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Secret, type RotatingSecret } from "../../../packages/config/index.js";
import { MemoryRelayStore, NearRpcError, publicKeyOf } from "../../../packages/chains/near/index.js";
import {
  FakeNearRpc,
  newUser,
  RELAYER,
  relayerKeys,
  ROOT,
  signDelegate,
  USDC,
  VAULT,
  type User,
} from "../../../packages/chains/near/near.fixtures.js";
import { buildRelayerApp } from "./app.js";

const TOKEN = "t".repeat(40);
const token = new Secret(TOKEN);
const authToken: RotatingSecret = {
  current: token,
  previous: undefined,
  accepts: (candidate) => token.equals(candidate),
};
const auth = { authorization: `Bearer ${TOKEN}` };

let rpc: FakeNearRpc;
let keys: string[];
let ada: User;
let app: ReturnType<typeof buildRelayerApp>;
const rootKey = KeyPair.fromRandom("ed25519");

beforeEach(() => {
  rpc = new FakeNearRpc();
  keys = relayerKeys(5);
  for (const key of keys) rpc.addKey(RELAYER, publicKeyOf(key), { nonce: 1n, permission: "FullAccess" });
  rpc.addKey(ROOT, rootKey.getPublicKey().toString());
  rpc.addAccount(USDC, true);
  ada = newUser("ada.fliq.testnet");
  rpc.addKey(ada.accountId, ada.publicKey);
  const store = new MemoryRelayStore();
  app = buildRelayerApp({
    authToken,
    relay: {
      rpc,
      store,
      policy: { vaultContractId: VAULT, usdcContractId: USDC },
      relayerAccountId: RELAYER,
      relayerKeys: keys,
      now: Date.now,
    },
    provision: {
      rpc,
      store,
      root: { accountId: ROOT, privateKey: rootKey.toString() },
      fundingYocto: 0n,
      storageContracts: [USDC, VAULT],
    },
  });
});

afterEach(async () => {
  await app.close();
});

const post = (url: string, payload: unknown, headers: Record<string, string> = auth) =>
  app.inject({ method: "POST", url, payload: payload as object, headers });

describe("relayer HTTP", () => {
  it("answers health checks without a token", async () => {
    expect((await app.inject({ method: "GET", url: "/health" })).json()).toEqual({ status: "ok" });
  });

  it.each([
    ["no token", {}],
    ["a wrong token", { authorization: `Bearer ${"x".repeat(40)}` }],
    ["a non-bearer scheme", { authorization: `Basic ${TOKEN}` }],
  ])("refuses requests with %s", async (_, headers) => {
    const response = await post("/v1/relays", { signed_delegate: "AAAA" }, headers);
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: "unauthorized", message: "missing or wrong relayer token" },
    });
  });

  it("relays a signed delegate and answers in snake case", async () => {
    const response = await post("/v1/relays", { signed_delegate: (await signDelegate(ada)).base64 });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "succeeded",
      tx_hash: rpc.sent[0]!.txHash,
      delegate_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      sender_id: ada.accountId,
      receiver_id: VAULT,
      failures: [],
    });
    const lookup = await app.inject({
      method: "GET",
      url: `/v1/relays/${response.json().delegate_hash}`,
      headers: auth,
    });
    expect(lookup.json()).toEqual(response.json());
  });

  it("answers 202 while the outcome is unknown", async () => {
    rpc.behaviour = () => {
      throw new NearRpcError("send_tx", "timeout", "no response in time");
    };
    expect((await post("/v1/relays", { signed_delegate: (await signDelegate(ada)).base64 })).statusCode).toBe(
      202,
    );
  });

  it.each([
    ["an extra field", { signed_delegate: "AAAA", fee_payer: "me" }, 400, "invalid_request"],
    ["a missing field", {}, 400, "invalid_request"],
    ["garbage instead of a delegate", { signed_delegate: "AAAA" }, 400, "invalid_delegate.malformed"],
  ])("refuses %s", async (_, body, status, codeName) => {
    const response = await post("/v1/relays", body);
    expect(response.statusCode).toBe(status);
    expect(response.json().error.code).toBe(codeName);
  });

  it("refuses a call outside the allowlist with 403", async () => {
    const response = await post("/v1/relays", {
      signed_delegate: (await signDelegate(ada, { receiverId: "evil.testnet" })).base64,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("not_allowed");
  });

  it("refuses a replayed nonce with 409", async () => {
    const response = await post("/v1/relays", {
      signed_delegate: (await signDelegate(ada, { nonce: 1n })).base64,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("nonce_used");
  });

  it("answers 400 for a malformed lookup and 404 for an unknown delegate", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/relays/xyz", headers: auth })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: "GET", url: `/v1/relays/${"a".repeat(64)}`, headers: auth })).statusCode,
    ).toBe(404);
  });

  it("creates an agent's account without storage registration when asked to skip it", async () => {
    const agent = newUser("claude-bob.fliq.testnet");
    const created = await post("/v1/accounts", { account_id: agent.accountId, public_key: agent.publicKey, register_storage: false });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ status: "created", storage: {} });
  });

  it("creates an account with 201, then links it with 200", async () => {
    const bob = newUser("bob.fliq.testnet");
    const created = await post("/v1/accounts", { account_id: bob.accountId, public_key: bob.publicKey });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      status: "created",
      account_id: bob.accountId,
      public_key: bob.publicKey,
      storage: { [USDC]: "registered", [VAULT]: "not_deployed" },
    });
    const linked = await post("/v1/accounts", { account_id: bob.accountId, public_key: bob.publicKey });
    expect(linked.statusCode).toBe(200);
    expect(linked.json().status).toBe("linked");
  });

  it("answers 409 when the name belongs to another key and 400 for a bad name", async () => {
    expect(
      (await post("/v1/accounts", { account_id: ada.accountId, public_key: newUser("x").publicKey }))
        .statusCode,
    ).toBe(409);
    expect(
      (await post("/v1/accounts", { account_id: "ada.evil.testnet", public_key: ada.publicKey })).statusCode,
    ).toBe(400);
  });

  it("tops up the owner for an agent's storage deposit once, with 201 then 200", async () => {
    rpc.addAccount("claude-ada.fliq.testnet");
    rpc.setAmount(ada.accountId, 0n);
    const body = { account_id: ada.accountId, agent_id: "claude-ada.fliq.testnet" };
    const funded = await post("/v1/accounts/agent-deposit", body);
    expect(funded.statusCode).toBe(201);
    expect(funded.json()).toMatchObject({ status: "funded", account_id: ada.accountId, agent_id: body.agent_id });
    const again = await post("/v1/accounts/agent-deposit", body);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ status: "already_funded", yocto: "0", tx_hash: null });
    expect(rpc.sent.filter((tx) => tx.actionKinds.includes("transfer"))).toHaveLength(1);
    expect((await post("/v1/accounts/agent-deposit", { ...body, extra: 1 })).statusCode).toBe(400);
  });

  it("reports balances against the 5 NEAR target without exposing keys", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/status", headers: auth });
    expect(response.json()).toMatchObject({
      relayer: { accountId: RELAYER, level: "ok", target: "5.000", keys: 5 },
      account_creator: { accountId: ROOT, level: "ok" },
    });
    for (const key of [...keys, rootKey.toString()]) expect(response.body).not.toContain(key);
  });
});
