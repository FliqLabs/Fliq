import { beforeEach, describe, expect, it } from "vitest";
import {
  MemoryRelayStore,
  NearRpcError,
  publicKeyOf,
  relay,
  RelayError,
  RELAYS_PER_SENDER_PER_HOUR,
  relayStatus,
  type RelayDeps,
  type TxOutcome,
} from "./index";
import {
  FakeNearRpc,
  newUser,
  RELAYER,
  relayerKeys,
  signDelegate,
  USDC,
  VAULT,
  type User,
} from "./near.fixtures";

let rpc: FakeNearRpc;
let store: MemoryRelayStore;
let deps: RelayDeps;
let keys: string[];
let ada: User;

const code = async (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (error: RelayError) => error.code ?? error.name,
  );

beforeEach(() => {
  rpc = new FakeNearRpc();
  store = new MemoryRelayStore();
  keys = relayerKeys(5);
  for (const key of keys) rpc.addKey(RELAYER, publicKeyOf(key), { nonce: 7_000n, permission: "FullAccess" });
  ada = newUser("ada.fliq.testnet");
  rpc.addKey(ada.accountId, ada.publicKey, { nonce: 100n, permission: "FullAccess" });
  deps = {
    rpc,
    store,
    policy: { vaultContractId: VAULT, usdcContractId: USDC },
    relayerAccountId: RELAYER,
    relayerKeys: keys,
    now: () => Date.parse("2026-11-05T12:00:00Z"),
  };
});

describe("relay", () => {
  it("wraps the user's exact signed delegate in a transaction the relayer signs and pays for", async () => {
    const delegate = await signDelegate(ada);
    const result = await relay(deps, delegate.base64);
    const [sent] = rpc.sent;
    expect(sent).toMatchObject({
      signerId: RELAYER,
      receiverId: ada.accountId,
      nonce: 7_001n,
      actionKinds: ["signedDelegate"],
    });
    expect(Buffer.from(sent!.signedDelegate!).equals(Buffer.from(delegate.bytes))).toBe(true);
    expect(keys.map(publicKeyOf)).toContain(sent!.publicKey);
    expect(result).toEqual({
      status: "succeeded",
      txHash: sent!.txHash,
      delegateHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      senderId: ada.accountId,
      receiverId: VAULT,
      failures: [],
    });
  });

  it("returns the first result for a repeated delegate and never pays twice", async () => {
    const { base64 } = await signDelegate(ada);
    const first = await relay(deps, base64);
    expect(await relay(deps, base64)).toEqual(first);
    expect(rpc.sent).toHaveLength(1);
  });

  it("sponsors only one of two identical requests that arrive together", async () => {
    const { base64 } = await signDelegate(ada);
    const results = await Promise.all([
      relay(deps, base64).catch((e: RelayError) => e.code),
      relay(deps, base64).catch((e: RelayError) => e.code),
    ]);
    expect(rpc.sent).toHaveLength(1);
    expect(results).toContain("in_progress");
  });

  it(`allows ${RELAYS_PER_SENDER_PER_HOUR} relays per sender per hour, without affecting other senders`, async () => {
    for (let i = 0; i < RELAYS_PER_SENDER_PER_HOUR; i += 1) {
      await relay(deps, (await signDelegate(ada, { nonce: 101n + BigInt(i) })).base64);
    }
    expect(await code(relay(deps, (await signDelegate(ada, { nonce: 500n })).base64))).toBe("rate_limited");
    const bob = newUser("bob.fliq.testnet");
    rpc.addKey(bob.accountId, bob.publicKey);
    expect(await code(relay(deps, (await signDelegate(bob)).base64))).toBe("ok");
  });

  it("does not count a duplicate against the rate limit", async () => {
    const { base64 } = await signDelegate(ada);
    for (let i = 0; i < 40; i += 1) await relay(deps, base64);
    expect(await code(relay(deps, (await signDelegate(ada, { nonce: 200n })).base64))).toBe("ok");
  });

  it.each([
    ["an expired delegate", { maxBlockHeight: 5_000n }, "expired"],
    ["a delegate valid too far ahead", { maxBlockHeight: 5_000n + 1_201n }, "validity_too_long"],
    ["a nonce the key already used", { nonce: 100n }, "nonce_used"],
  ])("refuses %s before paying anything", async (_, spec, expected) => {
    expect(await code(relay(deps, (await signDelegate(ada, spec)).base64))).toBe(expected);
    expect(rpc.sent).toEqual([]);
  });

  it("refuses a key that is not on the sender's account", async () => {
    const mallory = newUser("ada.fliq.testnet");
    expect(await code(relay(deps, (await signDelegate(mallory)).base64))).toBe("unknown_key");
  });

  it("holds a function-call key to its own receiver and methods", async () => {
    const agent = newUser("ada.fliq.testnet");
    rpc.addKey(agent.accountId, agent.publicKey, {
      nonce: 1n,
      permission: { receiverId: VAULT, methodNames: ["release_order"], allowance: null },
    });
    expect(await code(relay(deps, (await signDelegate(agent, { methodName: "payout" })).base64))).toBe(
      "key_not_allowed",
    );
    expect(
      await code(
        relay(
          deps,
          (await signDelegate(agent, { methodName: "release_order", args: { order_id: "po_1" } })).base64,
        ),
      ),
    ).toBe("ok");
  });

  it("reports pending with the transaction hash when the outcome is unknown, and does not resubmit", async () => {
    rpc.behaviour = () => {
      throw new NearRpcError("send_tx", "timeout", "no response in time");
    };
    const { base64 } = await signDelegate(ada);
    const pending = await relay(deps, base64);
    expect(pending.status).toBe("pending");
    expect(pending.txHash).toBe(rpc.sent[0]!.txHash);
    expect(await relay(deps, base64)).toEqual(pending);
    expect(rpc.sent).toHaveLength(1);

    const settled: TxOutcome = { txHash: pending.txHash, status: "succeeded", failures: [], gasBurnt: 1n };
    rpc.setStatus(pending.txHash, settled);
    expect((await relayStatus(deps, pending.delegateHash))?.status).toBe("succeeded");
  });

  it("treats an unreadable answer after sending as unknown, never as a retryable failure", async () => {
    rpc.behaviour = () => {
      throw new NearRpcError("send_tx", "invalid_response", "expected an object");
    };
    const { base64 } = await signDelegate(ada);
    expect((await relay(deps, base64)).status).toBe("pending");
    await relay(deps, base64);
    expect(rpc.sent).toHaveLength(1);
  });

  it("lets the user retry when the chain refused the transaction outright", async () => {
    rpc.behaviour = () => {
      throw new NearRpcError("send_tx", "invalid_transaction", "InvalidNonce");
    };
    const { base64 } = await signDelegate(ada);
    expect(await code(relay(deps, base64))).toBe("rejected_by_chain");
    rpc.behaviour = (tx) => ({ txHash: tx.txHash, status: "succeeded", failures: [], gasBurnt: 1n });
    expect((await relay(deps, base64)).status).toBe("succeeded");
  });

  it("reports a failed inner call as failed with its reason", async () => {
    rpc.behaviour = (tx) => ({
      txHash: tx.txHash,
      status: "failed",
      failures: ['{"ActionError":"ExecutionError"}'],
      gasBurnt: 1n,
    });
    const result = await relay(deps, (await signDelegate(ada)).base64);
    expect(result).toMatchObject({ status: "failed", failures: ['{"ActionError":"ExecutionError"}'] });
  });

  it("uses a different key for each concurrent relay, and says so when every key is busy", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    rpc.behaviour = async (tx) => {
      await gate;
      return { txHash: tx.txHash, status: "succeeded", failures: [], gasBurnt: 1n };
    };
    const senders = Array.from({ length: 6 }, (_, i) => newUser(`user${i}.fliq.testnet`));
    for (const sender of senders) rpc.addKey(sender.accountId, sender.publicKey);
    const delegates = await Promise.all(senders.map((sender) => signDelegate(sender)));
    const running = delegates.slice(0, 5).map((delegate) => relay(deps, delegate.base64));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await code(relay(deps, delegates[5]!.base64))).toBe("no_key_available");
    release();
    await Promise.all(running);
    expect(new Set(rpc.sent.map((tx) => tx.publicKey)).size).toBe(5);
    expect(await code(relay(deps, delegates[5]!.base64))).toBe("ok");
  });

  it("never puts relayer key material in a result or error", async () => {
    const result = JSON.stringify(await relay(deps, (await signDelegate(ada)).base64));
    const error = await relay(deps, (await signDelegate(ada, { nonce: 1n })).base64).catch(
      (e: Error) => e.message,
    );
    for (const key of keys) {
      expect(result).not.toContain(key);
      expect(String(error)).not.toContain(key);
    }
  });
});
