import { PublicKey } from "near-api-js";
import { describe, expect, it } from "vitest";
import { verifySignedDelegate } from "../../packages/chains/near/delegate.js";
import {
  newUser,
  PAYOUT_ARGS,
  signDelegate as nearApiSign,
  VAULT,
} from "../../packages/chains/near/near.fixtures.js";
import { checkPolicy } from "../../packages/chains/near/policy.js";
import { base58Decode, base58Encode } from "../src/agent/base58.js";
import { AgentClient } from "../src/agent/agent-client.js";
import { agentKeyFrom, generateAgentKey, signDelegate } from "../src/agent/delegate.js";

const AGENT = "agent-1.ada.fliq.testnet";
const PAYOUT_GAS = 80_000_000_000_000n;

describe("agent delegate signing", () => {
  it("produces byte for byte the signed delegate near-api-js produces", async () => {
    const user = newUser(AGENT);
    const agent = await agentKeyFrom(AGENT, user.key.toString());
    const ours = await signDelegate(agent, {
      call: { receiverId: VAULT, methodName: "payout", args: PAYOUT_ARGS, gas: PAYOUT_GAS, deposit: 0n },
      nonce: 101n,
      maxBlockHeight: 5_100n,
    });
    const theirs = await nearApiSign(user);
    expect(ours.signedDelegate).toBe(theirs.base64);
  });

  it("passes the relayer's signature check and allowlist for a vault payout", async () => {
    const user = newUser(AGENT);
    const rpcCalls: unknown[] = [];
    const fakeRpc = (async (_url: string, init: RequestInit) => {
      rpcCalls.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({ result: { nonce: 41, block_height: 5_000, permission: "FullAccess" } }),
      );
    }) as typeof fetch;
    const agent = new AgentClient({
      baseUrl: "http://api.test/v1",
      key: await agentKeyFrom(AGENT, user.key.toString()),
      nearRpcUrl: "http://rpc.test",
      fetch: fakeRpc,
    });
    const signedDelegate = await agent.signStep({
      kind: "function_call",
      receiver_id: VAULT,
      method_name: "payout",
      args: PAYOUT_ARGS,
      gas: PAYOUT_GAS.toString(),
      deposit: "0",
      public_key: null,
    });

    const verified = verifySignedDelegate(signedDelegate);
    expect(verified).toMatchObject({
      senderId: AGENT,
      receiverId: VAULT,
      nonce: 42n,
      maxBlockHeight: 5_120n,
    });
    expect(verified.publicKey).toBe(user.publicKey);
    expect(() =>
      checkPolicy({ vaultContractId: VAULT, usdcContractId: "usdc.fliq.testnet" }, verified),
    ).not.toThrow();
    expect(rpcCalls[0]).toMatchObject({
      method: "query",
      params: { request_type: "view_access_key", account_id: AGENT, public_key: user.publicKey },
    });
  });

  it("refuses a key that is not a 64-byte ed25519 secret", async () => {
    await expect(agentKeyFrom(AGENT, "ed25519:abc")).rejects.toThrow("64 bytes");
    await expect(agentKeyFrom(AGENT, "secp256k1:abc")).rejects.toThrow("64 bytes");
  });

  it("makes a key that loads back and signs for its printed public key", async () => {
    const { secretKey, publicKey } = await generateAgentKey();
    const agent = await agentKeyFrom(AGENT, secretKey);
    const message = new TextEncoder().encode("fliq");
    expect(PublicKey.fromString(publicKey).verify(message, await agent.sign(message))).toBe(true);
  });

  it("round-trips base58 with leading zero bytes", () => {
    const bytes = Uint8Array.from([0, 0, 1, 2, 255]);
    expect(base58Decode(base58Encode(bytes))).toEqual(bytes);
  });
});
