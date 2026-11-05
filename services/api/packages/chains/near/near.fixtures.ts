import { createHash } from "node:crypto";
import {
  actions,
  baseEncode,
  buildDelegateAction,
  decodeSignedTransaction,
  encodeSignedDelegate,
  encodeTransaction,
  KeyPair,
  KeyPairSigner,
  KeyType,
  PublicKey,
} from "near-api-js";
import type { AccessKeyView, AccountView, FinalBlock, NearRpc, TxOutcome } from "./rpc";

export const VAULT = "vault.fliq.testnet";
export const USDC = "usdc.fliq.testnet";
export const RELAYER = "fliq-relayer.testnet";
export const ROOT = "fliq.testnet";
export const TGAS = 1_000_000_000_000n;

export type SentTx = {
  signerId: string;
  publicKey: string;
  receiverId: string;
  nonce: bigint;
  txHash: string;
  actionKinds: string[];
  signedDelegate: Uint8Array | null;
  raw: ReturnType<typeof decodeSignedTransaction>;
};

type Behaviour = (tx: SentTx) => Promise<TxOutcome> | TxOutcome;

// A small in-memory chain: just enough state (accounts, keys, nonces, storage) to drive the relayer and the
// account creator, and a decoder for every transaction they send.
export class FakeNearRpc implements NearRpc {
  height = 5_000n;
  readonly sent: SentTx[] = [];
  readonly #keys = new Map<string, AccessKeyView>();
  readonly #accounts = new Map<string, AccountView>();
  readonly #storage = new Set<string>();
  readonly #statuses = new Map<string, TxOutcome>();
  behaviour: Behaviour = (tx) => ({ txHash: tx.txHash, status: "succeeded", failures: [], gasBurnt: 1n });

  addAccount(accountId: string, contract = false): void {
    this.#accounts.set(accountId, {
      amount: 10n ** 25n,
      storageUsage: 200,
      codeHash: contract ? "Contract1111111111111111111111111" : "11111111111111111111111111111111",
    });
  }

  addKey(
    accountId: string,
    publicKey: string,
    view: AccessKeyView = { nonce: 100n, permission: "FullAccess" },
  ): void {
    if (!this.#accounts.has(accountId)) this.addAccount(accountId);
    this.#keys.set(`${accountId}|${publicKey}`, view);
  }

  registerStorage(contract: string, accountId: string): void {
    this.#storage.add(`${contract}|${accountId}`);
  }

  setStatus(txHash: string, outcome: TxOutcome): void {
    this.#statuses.set(txHash, outcome);
  }

  async accessKey(accountId: string, publicKey: string) {
    return this.#keys.get(`${accountId}|${publicKey}`) ?? null;
  }

  async account(accountId: string) {
    return this.#accounts.get(accountId) ?? null;
  }

  async callView(contractId: string, method: string, args: unknown) {
    const accountId = (args as { account_id?: string }).account_id;
    if (method === "storage_balance_of") {
      return this.#storage.has(`${contractId}|${accountId}`)
        ? { total: "1250000000000000000000", available: "0" }
        : null;
    }
    if (method === "storage_balance_bounds")
      return { min: "1250000000000000000000", max: "1250000000000000000000" };
    throw new Error(`unexpected view ${method}`);
  }

  async finalBlock(): Promise<FinalBlock> {
    return { hash: "11111111111111111111111111111111", height: this.height };
  }

  async sendTransaction(base64: string): Promise<TxOutcome> {
    const tx = decodeSent(base64);
    this.sent.push(tx);
    const outcome = await this.behaviour(tx);
    if (outcome.status === "succeeded") this.#apply(tx);
    return outcome;
  }

  async transactionStatus(txHash: string) {
    return this.#statuses.get(txHash) ?? null;
  }

  #apply(tx: SentTx): void {
    const key = this.#keys.get(`${tx.signerId}|${tx.publicKey}`);
    if (key) this.#keys.set(`${tx.signerId}|${tx.publicKey}`, { ...key, nonce: tx.nonce });
    const added = tx.raw.transaction.actions.find((action) => action.addKey)?.addKey;
    if (tx.actionKinds.includes("createAccount") && added) {
      this.addAccount(tx.receiverId);
      this.addKey(tx.receiverId, publicKeyText(added.publicKey));
    }
    const call = tx.raw.transaction.actions.find((action) => action.functionCall)?.functionCall;
    if (call?.methodName === "storage_deposit") {
      const args = JSON.parse(Buffer.from(call.args).toString()) as { account_id: string };
      this.registerStorage(tx.receiverId, args.account_id);
    }
  }
}

export function decodeSent(base64: string): SentTx {
  const raw = decodeSignedTransaction(new Uint8Array(Buffer.from(base64, "base64")));
  const transaction = raw.transaction;
  const kinds = transaction.actions.map(
    (action) => Object.keys(action).find((key) => key !== "enum") ?? "unknown",
  );
  const signed = transaction.actions.find((action) => action.signedDelegate)?.signedDelegate;
  return {
    signerId: transaction.signerId,
    publicKey: transaction.publicKey.toString(),
    receiverId: transaction.receiverId,
    nonce: transaction.nonce,
    txHash: baseEncode(new Uint8Array(createHash("sha256").update(encodeTransaction(transaction)).digest())),
    actionKinds: kinds,
    signedDelegate: signed ? encodeSignedDelegate(signed) : null,
    raw,
  };
}

// Decoded transactions carry keys in their Borsh form, not as PublicKey objects.
export function publicKeyText(key: unknown): string {
  const data = (key as { ed25519Key?: { data: number[] | Uint8Array } }).ed25519Key?.data;
  if (!data) throw new Error("expected an ed25519 key");
  return new PublicKey({ keyType: KeyType.ED25519, data: Uint8Array.from(data) }).toString();
}

export type DelegateSpec = {
  receiverId?: string;
  methodName?: string;
  args?: Record<string, unknown>;
  gas?: bigint;
  deposit?: bigint;
  nonce?: bigint;
  maxBlockHeight?: bigint;
  extraActions?: ReturnType<typeof actions.transfer>[];
};

export type User = { accountId: string; key: KeyPair; publicKey: string };

export function newUser(accountId: string): User {
  const key = KeyPair.fromRandom("ed25519");
  return { accountId, key, publicKey: key.getPublicKey().toString() };
}

export async function signDelegate(
  user: User,
  spec: DelegateSpec = {},
): Promise<{ base64: string; bytes: Uint8Array }> {
  const delegate = buildDelegateAction({
    senderId: user.accountId,
    receiverId: spec.receiverId ?? VAULT,
    actions: [
      actions.functionCall(
        spec.methodName ?? "payout",
        spec.args ?? { order_id: "po_1" },
        spec.gas ?? 30n * TGAS,
        spec.deposit ?? 0n,
      ),
      ...(spec.extraActions ?? []),
    ],
    nonce: spec.nonce ?? 101n,
    maxBlockHeight: spec.maxBlockHeight ?? 5_100n,
    publicKey: user.key.getPublicKey(),
  });
  const { signedDelegate } = await new KeyPairSigner(user.key).signDelegateAction(delegate);
  const bytes = encodeSignedDelegate(signedDelegate);
  return { base64: Buffer.from(bytes).toString("base64"), bytes };
}

export function relayerKeys(count: number): string[] {
  return Array.from({ length: count }, () => KeyPair.fromRandom("ed25519").toString());
}
