import { KeyType, PublicKey } from "near-api-js";
import { NearRpcError, type NearRpc } from "./rpc";
import type { RelayStore } from "./store";
import {
  createAccountActions,
  publicKeyOf,
  signTransaction,
  storageDepositActions,
  transferActions,
  type SigningKey,
} from "./transactions";

// An account with no contract has this code hash.
const NO_CONTRACT = "11111111111111111111111111111111";
const LOCK_TTL_MS = 60_000;
const LABEL = /^[a-z0-9]+([-_][a-z0-9]+)*$/;
const MAX_ACCOUNT_ID = 64;
// What set_agent attaches (MAX_AGENT_STORAGE_DEPOSIT in policy.ts) twice over: the vault refunds what the policy's
// storage does not use, so this covers connecting the agent and later changes to its limits.
export const AGENT_DEPOSIT_FLOOR = 2n * 10n ** 22n;
// Each NEAR account byte locks this much; the deposit must come from what is left over.
const YOCTO_PER_BYTE = 10n ** 19n;
// One top-up per agent account, ever. The marker outlives any agent policy, so revoking and reconnecting is free.
const AGENT_FUNDED_TTL_MS = 5 * 365 * 24 * 60 * 60_000;

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
// An agent's account never holds a balance, so it skips storage registration: two fewer transactions to wait for.
export async function provisionAccount(
  deps: ProvisionDeps,
  accountId: string,
  userPublicKey: string,
  options: { registerStorage?: boolean } = {},
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
    if (options.registerStorage === false) return { status, accountId, publicKey, txHashes, storage };
    // The checks are reads, so they run together. The deposits share the root key and go one after another.
    const needs = await Promise.all(deps.storageContracts.map((contract) => storageNeed(deps, contract, accountId)));
    for (const [index, contract] of deps.storageContracts.entries()) {
      const need = needs[index] as StorageNeed;
      if ("state" in need) {
        storage[contract] = need.state;
        continue;
      }
      const outcome = await rootTransaction(deps, contract, storageDepositActions(accountId, need.deposit));
      storage[contract] = outcome.status === "pending" ? "pending" : "registered";
      txHashes.push(outcome.txHash);
    }
    return { status, accountId, publicKey, txHashes, storage };
  } finally {
    await deps.store.release(lock);
  }
}

export type AgentDepositResult = {
  status: "funded" | "already_funded" | "not_needed" | "pending";
  accountId: string;
  agentId: string;
  yocto: string;
  txHash: string | null;
};

// A fresh fliq account holds almost no NEAR, but set_agent is a delegate action and its storage deposit comes from
// the owner's own balance. The root tops the owner up to AGENT_DEPOSIT_FLOOR, once per agent account, so a key that
// spends its NEAR elsewhere cannot keep refilling it: at most the floor per agent, and every agent costs an account.
export async function fundAgentDeposit(deps: ProvisionDeps, accountId: string, agentId: string): Promise<AgentDepositResult> {
  checkName(accountId, deps.root.accountId);
  checkName(agentId, deps.root.accountId);
  if (agentId === accountId) throw new AccountError("invalid_name", "agent_id must differ from account_id");
  const agent = await read(() => deps.rpc.account(agentId));
  if (!agent) throw new AccountError("invalid_name", `${agentId} does not exist yet`);
  const marker = `agent-deposit:${agentId}`;
  const earlier = await deps.store.claim(marker, LOCK_TTL_MS);
  if (earlier?.state === "in_progress") throw new AccountError("in_progress", `${agentId} is already being funded`);
  if (earlier) return { status: "already_funded", accountId, agentId, yocto: "0", txHash: null };
  try {
    const owner = await read(() => deps.rpc.account(accountId));
    if (!owner) throw new AccountError("invalid_name", `${accountId} does not exist`);
    const locked = BigInt(owner.storageUsage) * YOCTO_PER_BYTE;
    const free = owner.amount > locked ? owner.amount - locked : 0n;
    const shortfall = AGENT_DEPOSIT_FLOOR - free;
    if (shortfall <= 0n) {
      await markFunded(deps, marker, accountId, null);
      return { status: "not_needed", accountId, agentId, yocto: "0", txHash: null };
    }
    const outcome = await rootTransaction(deps, accountId, transferActions(shortfall));
    await markFunded(deps, marker, accountId, outcome.txHash);
    return { status: outcome.status === "pending" ? "pending" : "funded", accountId, agentId, yocto: shortfall.toString(), txHash: outcome.txHash };
  } catch (error) {
    await deps.store.forget(marker);
    throw error;
  }
}

async function markFunded(deps: ProvisionDeps, marker: string, accountId: string, txHash: string | null) {
  await deps.store.save(
    marker,
    { state: "succeeded", txHash: txHash ?? "", senderId: deps.root.accountId, receiverId: accountId, failures: [] },
    AGENT_FUNDED_TTL_MS,
  );
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

type StorageNeed = { state: StorageState } | { deposit: bigint };

async function storageNeed(deps: ProvisionDeps, contract: string, accountId: string): Promise<StorageNeed> {
  const [code, balance, bounds] = await Promise.all([
    read(() => deps.rpc.account(contract)),
    read(() => deps.rpc.callView(contract, "storage_balance_of", { account_id: accountId })).catch(() => undefined),
    read(() => deps.rpc.callView(contract, "storage_balance_bounds", {})).catch(() => undefined),
  ]);
  if (!code || code.codeHash === NO_CONTRACT) return { state: "not_deployed" };
  if (balance === undefined || bounds === undefined) throw new AccountError("rpc_unavailable", `${contract} did not answer`);
  if (balance !== null) return { state: "already_registered" };
  const min = (bounds as { min?: unknown } | null)?.min;
  if (typeof min !== "string" || !/^\d+$/.test(min)) {
    throw new AccountError("chain_failure", `${contract} returned no storage minimum`);
  }
  return { deposit: BigInt(min) };
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
