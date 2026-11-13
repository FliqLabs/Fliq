import assert from "node:assert/strict";
import { test } from "node:test";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import {
  LIFETIME_BLOCKS,
  encodeDelegateAction,
  encodeSignedDelegate,
  rawPublicKey,
  signingHash,
  stepAction,
  submitDelegate,
  vaultTransfer,
} from "../app/lib/near-delegate.ts";

// The same vector the iOS DelegateTests check: near-api-js 7.4.0, key seeded with bytes 1...32.
const NEAR_API_JS =
  "GQAAAGZyYW5rLmZsaXFhY2NvdW50LnRlc3RuZXQSAAAAZmxpcS12YXVsdC50ZXN0bmV0AQAAAAIIAAAAdHJhbnNmZXI9AAAAeyJ0b19hY2NvdW50IjoidG9iaS5mbGlxYWNjb3VudC50ZXN0bmV0IiwiYW1vdW50IjoiMjUwMDAwMDAifQDgV+tIGwAAAQAAAAAAAAAAAAAAAAAAACoAAAAAAAAA7BMAAAAAAAAAebVWLo/mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQAm1lt8+6PEeP2edzxGEZE/eXXtRiWRH6P/cVBi1VM+dKBHc18kF7T/y5tyVm9WgM1WtOTxk6itV1GXiXYia/8Bg==";

const seed = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1));
const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
  format: "der",
  type: "pkcs8",
});
const publicBytes = createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(-32);

const transfer = vaultTransfer(
  { sender: "frank.fliqaccount.testnet", publicKey: new Uint8Array(publicBytes), nonce: 42n, blockHeight: 5_100n - LIFETIME_BLOCKS },
  "fliq-vault.testnet",
  "tobi.fliqaccount.testnet",
  25_000_000n,
);

test("the action is encoded exactly as near-api-js encodes it", () => {
  const reference = Buffer.from(NEAR_API_JS, "base64");
  assert.deepEqual(Buffer.from(encodeDelegateAction(transfer)), reference.subarray(0, reference.length - 65));
});

test("signing our hash with the same key gives near-api-js's signed delegate byte for byte", async () => {
  const signature = sign(null, Buffer.from(await signingHash(transfer)), privateKey);
  assert.equal(encodeSignedDelegate(transfer, new Uint8Array(signature)), NEAR_API_JS);
});

test("a step from the API becomes a function call with its gas and deposit", () => {
  const action = stepAction(
    { sender: "frank.fliq.near", publicKey: new Uint8Array(publicBytes), nonce: 7n, blockHeight: 100n },
    {
      kind: "function_call",
      receiver_id: "fliq-vault.testnet",
      method_name: "remove_agent",
      args: { agent_id: "claude-frank.fliq.near" },
      gas: "50000000000000",
      deposit: "1",
      public_key: null,
    },
  );
  assert.equal(action.methodName, "remove_agent");
  assert.equal(action.gas, 50_000_000_000_000n);
  assert.equal(action.deposit, 1n);
  assert.equal(action.maxBlockHeight, 700n);
  assert.equal(new TextDecoder().decode(action.args), '{"agent_id":"claude-frank.fliq.near"}');
});

test("a public key only parses as 32 ed25519 bytes", () => {
  assert.equal(rawPublicKey("ed25519:5FjQ8mT3vXk2NcR7yLpW9sBdH4uZaE6gKoJt1qMi9kQ").length, 32);
  assert.throws(() => rawPublicKey("secp256k1:5FjQ8mT3vXk2NcR7yLpW9sBdH4uZaE6gKoJt1qMi9kQ"));
});

test("submitting uses the next nonce, relays once and follows a pending relay to its end", async () => {
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const { method } = JSON.parse(init.body);
    const result = method === "query" ? { nonce: 41 } : { header: { height: 4_500 } };
    return new Response(JSON.stringify({ result }));
  };
  const result = await submitDelegate(
    {
      rpcUrl: "https://rpc.testnet.near.org",
      sender: "frank.fliqaccount.testnet",
      publicKey: "ed25519:5FjQ8mT3vXk2NcR7yLpW9sBdH4uZaE6gKoJt1qMi9kQ",
      sign: async (message) => new Uint8Array(sign(null, Buffer.from(message), privateKey)),
      relay: async (signed) => {
        calls.push(["relay", signed]);
        return { status: "pending", delegate_hash: "abc", sender_id: "", receiver_id: "" };
      },
      relayStatus: async (hash) => {
        calls.push(["status", hash]);
        return { status: "succeeded", delegate_hash: hash, sender_id: "", receiver_id: "" };
      },
      pollMs: 0,
    },
    (signer) => {
      assert.equal(signer.nonce, 42n);
      assert.equal(signer.blockHeight, 4_500n);
      return { ...transfer, nonce: signer.nonce, maxBlockHeight: signer.blockHeight + LIFETIME_BLOCKS };
    },
  );
  assert.equal(result.status, "succeeded");
  assert.deepEqual(calls.map(([kind]) => kind), ["relay", "status"]);
});

test("a relay the vault refuses surfaces the vault's reason", async () => {
  globalThis.fetch = async (_url, init) =>
    new Response(JSON.stringify({ result: JSON.parse(init.body).method === "query" ? { nonce: 1 } : { header: { height: 1 } } }));
  await assert.rejects(
    submitDelegate(
      {
        rpcUrl: "x",
        sender: "frank.fliq.near",
        publicKey: "ed25519:5FjQ8mT3vXk2NcR7yLpW9sBdH4uZaE6gKoJt1qMi9kQ",
        sign: async () => new Uint8Array(64),
        relay: async () => ({ status: "failed", delegate_hash: "h", sender_id: "", receiver_id: "", failures: ["Over the daily cap."] }),
        relayStatus: async () => {
          throw new Error("not called");
        },
      },
      (signer) => ({ ...transfer, nonce: signer.nonce }),
    ),
    /Over the daily cap\./,
  );
});
