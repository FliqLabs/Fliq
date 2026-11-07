import { deserialize } from "borsh";
import { KeyPair, SCHEMA } from "near-api-js";
import { describe, expect, it } from "vitest";
import type { NearRpc, TxOutcome } from "../near/rpc";
import { NearVault, VaultCallError } from "./near";
import { VaultError } from "./types";

const CONTRACT = "vault.fliq.testnet";
const REGISTRAR = "registrar.fliq.testnet";
const TGAS = 1_000_000_000_000n;

type Sent = {
  method: string;
  args: Record<string, unknown>;
  gas: bigint;
  deposit: bigint;
  nonce: bigint;
  signer: string;
  receiver: string;
};

// Decodes what was actually signed, so the test checks the bytes the chain would see.
function decode(base64: string): Sent {
  const signed = deserialize(SCHEMA.SignedTransaction, Buffer.from(base64, "base64")) as {
    transaction: {
      signerId: string;
      receiverId: string;
      nonce: bigint;
      actions: { functionCall: { methodName: string; args: Uint8Array; gas: bigint; deposit: bigint } }[];
    };
  };
  const call = signed.transaction.actions[0]?.functionCall;
  if (!call) throw new Error("not a function call");
  return {
    method: call.methodName,
    args: JSON.parse(Buffer.from(call.args).toString("utf8")),
    gas: BigInt(call.gas),
    deposit: BigInt(call.deposit),
    nonce: BigInt(signed.transaction.nonce),
    signer: signed.transaction.signerId,
    receiver: signed.transaction.receiverId,
  };
}

function fakeChain(outcome: (sent: Sent) => Partial<TxOutcome> = () => ({})) {
  const sent: Sent[] = [];
  const views: { method: string; args: unknown }[] = [];
  let nonce = 40n;
  const answers = new Map<string, unknown>();
  const rpc: NearRpc = {
    accessKey: async () => ({ nonce, permission: "FullAccess" }),
    account: async () => null,
    callView: async (_contract, method, args) => {
      views.push({ method, args });
      return answers.get(method) ?? null;
    },
    finalBlock: async () => ({ hash: "11111111111111111111111111111111", height: 1n }),
    async sendTransaction(base64) {
      const tx = decode(base64);
      sent.push(tx);
      await new Promise((resolve) => setTimeout(resolve, 5));
      nonce = tx.nonce;
      return { txHash: "hash", status: "succeeded", failures: [], gasBurnt: 0n, ...outcome(tx) };
    },
    transactionStatus: async () => null,
  };
  return { rpc, sent, views, answers };
}

const registration = { accountId: REGISTRAR, privateKey: KeyPair.fromRandom("ed25519").toString() };
const vaultOn = (rpc: NearRpc) => new NearVault({ rpc, contractId: CONTRACT, registration });

describe("the deployed vault through NEAR RPC", () => {
  it("registers an order with the contract's argument names, U128 strings, 50 Tgas and no deposit", async () => {
    const chain = fakeChain();
    const tx = await vaultOn(chain.rpc).registerOrder({
      orderId: "po_9c2f71aa",
      payer: "frank.fliq.testnet",
      depositAddress: "0f3a9ec21e0f3a9ec21e0f3a9ec21e0f3a9ec21e0f3a9ec21e0f3a9ec21e0f3a",
      amount: 50_034_400n,
      expiresAtNs: 1_761_742_930_000_000_000n,
      corridor: "NG-NGN-bank",
    });
    expect(tx.txHash).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(chain.sent[0]).toEqual({
      method: "register_order",
      args: {
        order_id: "po_9c2f71aa",
        payer: "frank.fliq.testnet",
        deposit_address: "0f3a9ec21e0f3a9ec21e0f3a9ec21e0f3a9ec21e0f3a9ec21e0f3a9ec21e0f3a",
        amount: "50034400",
        expires_at_ns: "1761742930000000000",
        corridor: "NG-NGN-bank",
      },
      gas: 50n * TGAS,
      deposit: 0n,
      nonce: 41n,
      signer: REGISTRAR,
      receiver: CONTRACT,
    });
  });

  it("sends status refs with the contract's snake-case keys, leaving out the ones not given", async () => {
    const chain = fakeChain();
    await vaultOn(chain.rpc).setStatus("po_1", "settled", {
      provider: "paycrest",
      bankReference: "000013251029140213",
    });
    expect(chain.sent[0]?.args).toEqual({
      order_id: "po_1",
      status: "settled",
      refs: { provider: "paycrest", bank_reference: "000013251029140213" },
    });
  });

  it("gives recredit enough gas for its balance check and callback", async () => {
    const chain = fakeChain();
    await vaultOn(chain.rpc).recredit("po_1", 5_000_000n);
    expect(chain.sent[0]).toMatchObject({
      method: "recredit",
      args: { order_id: "po_1", amount: "5000000" },
      gas: 100n * TGAS,
      deposit: 0n,
    });
  });

  it("sends concurrent calls one after another, each with the next nonce", async () => {
    const chain = fakeChain();
    const vault = vaultOn(chain.rpc);
    await Promise.all([vault.releaseOrder("po_a"), vault.releaseOrder("po_b"), vault.releaseOrder("po_c")]);
    expect(chain.sent.map((tx) => tx.nonce)).toEqual([41n, 42n, 43n]);
  });

  it("turns a contract panic into its vault error code, and anything else into a call error", async () => {
    const panic = fakeChain(() => ({
      status: "failed",
      failures: [
        '{"ActionError":{"kind":{"FunctionCallError":{"ExecutionError":"Smart contract panicked: fliq_vault: REGISTRATION_ONLY"}}}}',
      ],
    }));
    await expect(vaultOn(panic.rpc).releaseOrder("po_1")).rejects.toMatchObject({
      code: "REGISTRATION_ONLY",
    });
    await expect(vaultOn(panic.rpc).releaseOrder("po_1")).rejects.toBeInstanceOf(VaultError);
    const gas = fakeChain(() => ({ status: "failed", failures: ['{"ActionError":"GasExceeded"}'] }));
    await expect(vaultOn(gas.rpc).releaseOrder("po_1")).rejects.toBeInstanceOf(VaultCallError);
  });

  it("keeps going after a failed call", async () => {
    let first = true;
    const chain = fakeChain(() => {
      if (!first) return {};
      first = false;
      return { status: "failed", failures: ["fliq_vault: INVALID_STATE"] };
    });
    const vault = vaultOn(chain.rpc);
    await expect(vault.releaseOrder("po_a")).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(vault.releaseOrder("po_b")).resolves.toMatchObject({ txHash: expect.any(String) });
  });

  it("reads the contract's receipt view, ignoring the verified track and statuses the backend does not record", async () => {
    const chain = fakeChain();
    chain.answers.set("get_receipt", {
      order_id: "po_1",
      payer: "frank.fliq.testnet",
      deposit_address: "deposit.testnet",
      amount: "50034400",
      expires_at_ns: "1761742930000000000",
      corridor: "NG-NGN-bank",
      state: "executed",
      status: "paying_out",
      recredited_amount: "0",
      order: {},
      transfer_state: "dispatched",
      expired: false,
      executing_since: null,
      backend_status: "paying_out",
      refs: { provider: "paycrest", provider_order: "pc_8c9d1a4b10" },
      last_updated: "1761742931000000000",
    });
    const vault = vaultOn(chain.rpc);
    expect(await vault.getReceipt("po_1")).toEqual({
      orderId: "po_1",
      payer: "frank.fliq.testnet",
      depositAddress: "deposit.testnet",
      amount: 50_034_400n,
      expiresAtNs: 1_761_742_930_000_000_000n,
      corridor: "NG-NGN-bank",
      state: "executed",
      status: "paying_out",
      refs: { provider: "paycrest", providerOrder: "pc_8c9d1a4b10" },
      recreditedAmount: 0n,
    });
    chain.answers.set("get_receipt", { ...(chain.answers.get("get_receipt") as object), status: "created" });
    expect((await vault.getReceipt("po_1"))?.status).toBeNull();
    chain.answers.delete("get_receipt");
    expect(await vault.getReceipt("missing")).toBeNull();
  });

  it("reads balances and an owner's agent policy", async () => {
    const chain = fakeChain();
    chain.answers.set("get_balance", { available: "199980000", reserved: "50034400", total: "250014400" });
    chain.answers.set("get_policy", {
      owner: "frank.fliq.testnet",
      agent_id: "claude.frank.fliq.testnet",
      public_key: "ed25519:abc",
      per_payout_cap: "36000000",
      daily_cap: "108000000",
      spent_today: "21800000",
      corridors: ["NG-NGN-bank"],
      cooldown_ns: "0",
      expiry_ns: "3600000000000",
      last_payout_at: null,
      revoked: false,
    });
    const vault = vaultOn(chain.rpc);
    expect(await vault.getBalance("frank.fliq.testnet")).toEqual({
      available: 199_980_000n,
      reserved: 50_034_400n,
      total: 250_014_400n,
    });
    expect(await vault.getAgent("frank.fliq.testnet", "claude.frank.fliq.testnet")).toEqual({
      owner: "frank.fliq.testnet",
      perPayoutCap: 36_000_000n,
      dailyCap: 108_000_000n,
      spentToday: 21_800_000n,
      corridors: ["NG-NGN-bank"],
      publicKey: "ed25519:abc",
      expiresAtNs: 3_600_000_000_000n,
      revoked: false,
    });
    expect(chain.views.at(-1)).toEqual({
      method: "get_policy",
      args: { owner: "frank.fliq.testnet", agent_id: "claude.frank.fliq.testnet" },
    });
  });
});
