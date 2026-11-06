import { KeyType, PublicKey } from "near-api-js";
import { NearRpcError, type NearRpc } from "./rpc";
import type { RelayStore } from "./store";
import {
  createAccountActions,
  publicKeyOf,
  signTransaction,
  storageDepositActions,
  type SigningKey,
} from "./transactions";

// An account with no contract has this code hash.
const NO_CONTRACT = "11111111111111111111111111111111";
const LOCK_TTL_MS = 60_000;
const LABEL = /^[a-z0-9]+([-_][a-z0-9]+)*$/;
const MAX_ACCOUNT_ID = 64;

export type StorageState = "registered" | "already_registered" | "not_deployed" | "pending";

export type ProvisionResult = {
  status: "created" | "linked" | "pending";
  accountId: string;
  publicKey: string;
  txHashes: string[];
  storage: Record<string, StorageState>;
};

export type AccountErrorCode =
  | "invalid_name"
  | "invalid_key"
  | "taken"
  | "in_progress"
  | "busy"
  | "chain_failure"
  | "rpc_unavailable";

export class AccountError extends Error {
  readonly code: AccountErrorCode;

  constructor(code: AccountErrorCode, detail: string) {
    super(detail);
    this.name = "AccountError";
    this.code = code;
  }
}

export type ProvisionDeps = {
  rpc: NearRpc;
  store: RelayStore;
  root: SigningKey;
  fundingYocto: bigint;
  // Contracts the new account must be registered on before it can receive tokens (USDC, the vault).
  storageContracts: readonly string[];
};

// Creates <label>.<root> owned by the user's own key, or links it if that exact key already controls it, then
// registers its storage. Idempotent: a retry after "pending" finishes the job without creating anything twice.
export async function provisionAccount(
  deps: ProvisionDeps,
  accountId: string,
  userPublicKey: string,
): Promise<ProvisionResult> {
  checkName(accountId, deps.root.accountId);
  const publicKey = checkKey(userPublicKey);

  const lockKey = `account:${accountId}`;
  const lock = await deps.store.lease([lockKey], LOCK_TTL_MS);
  if (!lock) throw new AccountError("in_progress", `${accountId} is already being set up`);
  try {
    const txHashes: string[] = [];
    let status: ProvisionResult["status"] = "linked";
    if (!(await controls(deps.rpc, accountId, publicKey))) {
      if (await read(() => deps.rpc.account(accountId))) {
        throw new AccountError("taken", `${accountId} already exists and is controlled by another key`);
      }
      const created = await rootTransaction(
        deps,
        accountId,
        createAccountActions(publicKey, deps.fundingYocto),
      );
      txHashes.push(created.txHash);
      if (created.status === "pending" || !(await controls(deps.rpc, accountId, publicKey))) {
        return { status: "pending", accountId, publicKey, txHashes, storage: {} };
      }
      status = "created";
    }

    const storage: Record<string, StorageState> = {};
    for (const contract of deps.storageContracts) {
      const registration = await registerStorage(deps, contract, accountId);
      storage[contract] = registration.state;
      if (registration.txHash) txHashes.push(registration.txHash);
    }
    return { status, accountId, publicKey, txHashes, storage };
  } finally {
    await deps.store.release(lock);
  }
}

export function checkName(accountId: string, rootAccountId: string): void {
  const suffix = `.${rootAccountId}`;
  const label = accountId.endsWith(suffix) ? accountId.slice(0, -suffix.length) : "";
  if (!LABEL.test(label) || accountId.length > MAX_ACCOUNT_ID) {
    throw new AccountError("invalid_name", `account must be <label>${suffix} with a valid NEAR label`);
  }
}

function checkKey(value: string): string {
  try {
    const key = PublicKey.fromString(value);
    if (key.keyType === KeyType.ED25519) return key.toString();
  } catch {
    throw new AccountError("invalid_key", "public_key must be ed25519:<base58>");
  }
  throw new AccountError("invalid_key", "only ed25519 keys are accepted");
}

async function controls(rpc: NearRpc, accountId: string, publicKey: string): Promise<boolean> {
  const key = await read(() => rpc.accessKey(accountId, publicKey));
  return key?.permission === "FullAccess";
}

async function registerStorage(
  deps: ProvisionDeps,
  contract: string,
  accountId: string,
): Promise<{ state: StorageState; txHash?: string }> {
  const code = await read(() => deps.rpc.account(contract));
  if (!code || code.codeHash === NO_CONTRACT) return { state: "not_deployed" };
  const balance = await read(() =>
    deps.rpc.callView(contract, "storage_balance_of", { account_id: accountId }),
  );
  if (balance !== null) return { state: "already_registered" };
  const bounds = (await read(() => deps.rpc.callView(contract, "storage_balance_bounds", {}))) as {
    min?: unknown;
  };
  if (typeof bounds?.min !== "string" || !/^\d+$/.test(bounds.min)) {
    throw new AccountError("chain_failure", `${contract} returned no storage minimum`);
  }
  const outcome = await rootTransaction(deps, contract, storageDepositActions(accountId, BigInt(bounds.min)));
  return { state: outcome.status === "pending" ? "pending" : "registered", txHash: outcome.txHash };
}

async function rootTransaction(
  deps: ProvisionDeps,
  receiverId: string,
  actions: Parameters<typeof signTransaction>[0]["actions"],
): Promise<{ status: "succeeded" | "pending"; txHash: string }> {
  const rootKey = publicKeyOf(deps.root.privateKey);
  const lease = await deps.store.lease([rootKey], LOCK_TTL_MS);
  if (!lease) throw new AccountError("busy", "the account creator is busy; retry shortly");
  try {
    const [key, block] = await Promise.all([
      read(() => deps.rpc.accessKey(deps.root.accountId, rootKey)),
      read(() => deps.rpc.finalBlock()),
    ]);
    if (!key) throw new AccountError("chain_failure", "the root key is not on the root account");
    const tx = await signTransaction({
      signer: deps.root,
      receiverId,
      nonce: await deps.store.nextNonce(rootKey, key.nonce),
      blockHash: block.hash,
      actions,
    });
    try {
      const outcome = await deps.rpc.sendTransaction(tx.base64);
      if (outcome.status === "failed") {
        throw new AccountError(
          "chain_failure",
          `transaction ${tx.txHash} failed: ${outcome.failures.join("; ")}`,
        );
      }
      return { status: "succeeded", txHash: tx.txHash };
    } catch (error) {
      if (error instanceof NearRpcError && error.kind !== "invalid_transaction")
        return { status: "pending", txHash: tx.txHash };
      if (error instanceof NearRpcError) throw new AccountError("chain_failure", error.message);
      throw error;
    }
  } finally {
    await deps.store.release(lease);
  }
}

async function read<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof NearRpcError) throw new AccountError("rpc_unavailable", error.message);
    throw error;
  }
}
