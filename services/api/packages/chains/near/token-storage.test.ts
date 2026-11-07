import { deserialize } from "borsh";
import { KeyPair, SCHEMA } from "near-api-js";
import { describe, expect, it } from "vitest";
import type { NearRpc } from "./rpc";
import { TokenStorage, TokenStorageError } from "./token-storage";

const USDC = "usdc.fliq.testnet";
const PAYER = "storage.fliq.testnet";
const TGAS = 1_000_000_000_000n;
const MIN = "1250000000000000000000";

type Signed = {
  transaction: {
    signerId: string;
    receiverId: string;
    nonce: bigint;
    actions: { functionCall: { methodName: string; args: Uint8Array; gas: bigint; deposit: bigint } }[];
  };
};

function fakeChain(registered: boolean, status: "succeeded" | "failed" = "succeeded") {
  const sent: Signed["transaction"][] = [];
  let nonce = 7n;
  const rpc: NearRpc = {
    accessKey: async () => ({ nonce, permission: "FullAccess" }),
    account: async () => null,
    callView: async (contract, method) => {
      expect(contract).toBe(USDC);
      if (method === "storage_balance_of") return registered ? { total: MIN, available: "0" } : null;
      if (method === "storage_balance_bounds") return { min: MIN, max: MIN };
      return null;
    },
    finalBlock: async () => ({ hash: "11111111111111111111111111111111", height: 1n }),
    async sendTransaction(base64) {
      const signed = deserialize(SCHEMA.SignedTransaction, Buffer.from(base64, "base64")) as Signed;
      sent.push(signed.transaction);
      nonce = BigInt(signed.transaction.nonce);
      return { txHash: "hash", status, failures: status === "failed" ? ["Smart contract panicked"] : [], gasBurnt: 0n };
    },
    transactionStatus: async () => null,
  };
  return { rpc, sent };
}

const payer = { accountId: PAYER, privateKey: KeyPair.fromRandom("ed25519").toString() };
const storageOn = (rpc: NearRpc) => new TokenStorage({ rpc, tokenContractId: USDC, payer });

describe("registering payout addresses on the token", () => {
  it("pays the token's minimum storage deposit for an unregistered address", async () => {
    const chain = fakeChain(false);
    expect(await storageOn(chain.rpc).ensure("deposit.near")).toEqual({ txHash: expect.any(String) });
    const tx = chain.sent[0];
    const call = tx?.actions[0]?.functionCall;
    expect({ signer: tx?.signerId, receiver: tx?.receiverId, nonce: BigInt(tx?.nonce ?? 0) }).toEqual({
      signer: PAYER,
      receiver: USDC,
      nonce: 8n,
    });
    expect(call?.methodName).toBe("storage_deposit");
    expect(JSON.parse(Buffer.from(call?.args ?? []).toString("utf8"))).toEqual({
      account_id: "deposit.near",
      registration_only: true,
    });
    expect(BigInt(call?.deposit ?? 0)).toBe(BigInt(MIN));
    expect(BigInt(call?.gas ?? 0)).toBe(30n * TGAS);
  });

  it("sends nothing when the address is already registered", async () => {
    const chain = fakeChain(true);
    expect(await storageOn(chain.rpc).ensure("deposit.near")).toBeNull();
    expect(chain.sent).toEqual([]);
  });

  it("sends concurrent registrations one after another, each with the next nonce", async () => {
    const chain = fakeChain(false);
    const storage = storageOn(chain.rpc);
    await Promise.all([storage.ensure("a.near"), storage.ensure("b.near")]);
    expect(chain.sent.map((tx) => BigInt(tx.nonce))).toEqual([8n, 9n]);
  });

  it("reports a refused deposit", async () => {
    const chain = fakeChain(false, "failed");
    await expect(storageOn(chain.rpc).ensure("deposit.near")).rejects.toBeInstanceOf(TokenStorageError);
  });
});
