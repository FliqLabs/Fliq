import { verifySignedDelegate, type VerifiedDelegate } from "./delegate";
import { checkPolicy, type RelayPolicy } from "./policy";
import { NearRpcError, type NearRpc } from "./rpc";
import type { RelayRecord, RelayStore } from "./store";
import { publicKeyOf, relayActions, signTransaction } from "./transactions";

export const RELAYS_PER_SENDER_PER_HOUR = 30;
const HOUR_MS = 60 * 60_000;
// About 20 minutes of blocks: a delegate valid for longer is a replay risk if it leaks.
export const MAX_VALIDITY_BLOCKS = 1_200n;
const RECORD_TTL_MS = 24 * HOUR_MS;
const LEASE_TTL_MS = 60_000;

export type RelayErrorCode =
  | "rate_limited"
  | "in_progress"
  | "expired"
  | "validity_too_long"
  | "unknown_key"
  | "nonce_used"
  | "key_not_allowed"
  | "no_key_available"
  | "rejected_by_chain"
  | "rpc_unavailable";

export class RelayError extends Error {
  readonly code: RelayErrorCode;

  constructor(code: RelayErrorCode, detail: string) {
    super(detail);
    this.name = "RelayError";
    this.code = code;
  }
}

export type RelayResult = {
  status: "succeeded" | "failed" | "pending";
  txHash: string;
  delegateHash: string;
  senderId: string;
  receiverId: string;
  failures: string[];
};

export type RelayDeps = {
  rpc: NearRpc;
  store: RelayStore;
  policy: RelayPolicy;
  relayerAccountId: string;
  relayerKeys: readonly string[];
  now: () => number;
};

// Verifies, then pays for, one user-signed delegate. The tx hash is recorded before sending, so a retry of the
// same delegate never sponsors a second transaction, even when the first outcome is unknown.
export async function relay(deps: RelayDeps, signedDelegateBase64: string): Promise<RelayResult> {
  const delegate = verifySignedDelegate(signedDelegateBase64);
  checkPolicy(deps.policy, delegate);

  const existing = await deps.store.claim(delegate.hash, RECORD_TTL_MS);
  if (existing) return fromRecord(delegate.hash, existing);

  let submitted = false;
  try {
    if (
      !(await deps.store.takeRateSlot(delegate.senderId, RELAYS_PER_SENDER_PER_HOUR, HOUR_MS, deps.now()))
    ) {
      throw new RelayError(
        "rate_limited",
        `${delegate.senderId} has used ${RELAYS_PER_SENDER_PER_HOUR} relays this hour`,
      );
    }
    const blockHash = await checkOnChain(deps.rpc, delegate);
    submitted = true;
    return await submit(deps, delegate, blockHash);
  } finally {
    if (!submitted) await deps.store.forget(delegate.hash);
  }
}

export async function relayStatus(
  deps: Pick<RelayDeps, "rpc" | "store" | "relayerAccountId">,
  delegateHash: string,
) {
  const record = await deps.store.read(delegateHash);
  if (!record || record.state === "in_progress") return record ? fromRecord(delegateHash, record) : null;
  if (record.state !== "pending" && record.state !== "submitted") return fromRecord(delegateHash, record);
  const outcome = await deps.rpc.transactionStatus(record.txHash, deps.relayerAccountId);
  if (!outcome) return fromRecord(delegateHash, record);
  const settled: RelayRecord = { ...record, state: outcome.status, failures: outcome.failures };
  await deps.store.save(delegateHash, settled, RECORD_TTL_MS);
  return fromRecord(delegateHash, settled);
}

async function checkOnChain(rpc: NearRpc, delegate: VerifiedDelegate): Promise<string> {
  const block = await read(() => rpc.finalBlock());
  if (delegate.maxBlockHeight <= block.height)
    throw new RelayError("expired", "the delegate's max block height has passed");
  if (delegate.maxBlockHeight > block.height + MAX_VALIDITY_BLOCKS) {
    throw new RelayError(
      "validity_too_long",
      `max block height may be at most ${MAX_VALIDITY_BLOCKS} blocks ahead`,
    );
  }
  const key = await read(() => rpc.accessKey(delegate.senderId, delegate.publicKey));
  if (!key) throw new RelayError("unknown_key", "the signing key is not an access key of the sender");
  if (delegate.nonce <= key.nonce)
    throw new RelayError("nonce_used", "the delegate's nonce has already been used");
  if (key.permission !== "FullAccess") {
    const call = delegate.calls[0];
    const allowed =
      key.permission.receiverId === delegate.receiverId &&
      (key.permission.methodNames.length === 0 ||
        key.permission.methodNames.includes(call?.methodName ?? "")) &&
      call?.deposit === 0n;
    if (!allowed) throw new RelayError("key_not_allowed", "the signing key may not make this call");
  }
  return block.hash;
}

async function submit(deps: RelayDeps, delegate: VerifiedDelegate, blockHash: string): Promise<RelayResult> {
  const lease = await deps.store.lease(deps.relayerKeys.map(publicKeyOf), LEASE_TTL_MS);
  if (!lease) {
    await deps.store.forget(delegate.hash);
    throw new RelayError("no_key_available", "every relayer key is busy; retry shortly");
  }
  const privateKey = deps.relayerKeys.find((key) => publicKeyOf(key) === lease.key) as string;
  const base = { senderId: delegate.senderId, receiverId: delegate.receiverId, failures: [] as string[] };
  let txHash: string | null = null;

  try {
    const key = await read(() => deps.rpc.accessKey(deps.relayerAccountId, lease.key));
    if (!key) throw new RelayError("no_key_available", "a relayer key is missing on chain");
    const tx = await signTransaction({
      signer: { accountId: deps.relayerAccountId, privateKey },
      receiverId: delegate.senderId,
      nonce: await deps.store.nextNonce(lease.key, key.nonce),
      blockHash,
      actions: relayActions(delegate.raw),
    });
    await deps.store.save(delegate.hash, { state: "submitted", txHash: tx.txHash, ...base }, RECORD_TTL_MS);
    txHash = tx.txHash;
    const outcome = await deps.rpc.sendTransaction(tx.base64);
    const record: RelayRecord = { state: outcome.status, txHash, ...base, failures: outcome.failures };
    await deps.store.save(delegate.hash, record, RECORD_TTL_MS);
    return fromRecord(delegate.hash, record);
  } catch (error) {
    if (txHash === null) {
      await deps.store.forget(delegate.hash);
      throw error;
    }
    // Only INVALID_TRANSACTION proves nothing ran, so only then may the user retry the same delegate.
    if (error instanceof NearRpcError && error.kind === "invalid_transaction") {
      await deps.store.forget(delegate.hash);
      throw new RelayError("rejected_by_chain", error.message);
    }
    const pending: RelayRecord = { state: "pending", txHash, ...base };
    await deps.store.save(delegate.hash, pending, RECORD_TTL_MS);
    return fromRecord(delegate.hash, pending);
  } finally {
    await deps.store.release(lease);
  }
}

function fromRecord(delegateHash: string, record: RelayRecord): RelayResult {
  if (record.state === "in_progress")
    throw new RelayError("in_progress", "this delegate is already being relayed");
  const status = record.state === "submitted" ? "pending" : record.state;
  return {
    status,
    txHash: record.txHash,
    delegateHash,
    senderId: record.senderId,
    receiverId: record.receiverId,
    failures: record.failures,
  };
}

async function read<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof NearRpcError) throw new RelayError("rpc_unavailable", error.message);
    throw error;
  }
}
