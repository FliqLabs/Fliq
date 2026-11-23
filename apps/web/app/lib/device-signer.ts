"use client";

import { derivePasskeyKey, loadNearKey, saveNearKey, type StoredNearKey } from "../claim-name/near-key";
import { addFullAccessKey, rawPublicKey, submitDelegate, type DelegateAction } from "./near-delegate";
import { walletApi, type User } from "./wallet-api";

const RPC_URL = process.env.NEXT_PUBLIC_NEAR_RPC_URL ?? "https://rpc.mainnet.fastnear.com";

export class NoDeviceKeyError extends Error {
  constructor() {
    super(
      "This browser can't approve payments yet. Approve one payment in the browser you used before and your passkey works here too, or restore with your recovery code in Account.",
    );
  }
}

type Key = Pick<StoredNearKey, "publicKey" | "privateKey">;

// The key made from the passkey at the last sign-in. Kept in memory only: the passkey makes it again any time.
let passkeyKey: { userId: string; key: Key } | null = null;
// Every signature for the account goes through here one at a time, so a key change and a payment never race for a nonce.
let queue: Promise<unknown> = Promise.resolve();

function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

/** True when this public key is a full-access key on the account. */
async function isFullAccessKey(account: string, publicKey: string) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "fliq-web",
      method: "query",
      params: { request_type: "view_access_key", finality: "optimistic", account_id: account, public_key: publicKey },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("NEAR is not answering.");
  const body = await response.json();
  const failure = String(body.error?.cause?.name ?? body.result?.error ?? "");
  if (failure) {
    if (failure.includes("UNKNOWN_ACCESS_KEY") || failure.includes("does not exist")) return false;
    throw new Error("NEAR could not read the account.");
  }
  return body.result?.permission === "FullAccess";
}

/**
 * Called after a passkey sign-in that returned a PRF secret. When the key made from the passkey is already on the
 * account and this browser has no key, it becomes this browser's key, so the user can pay with no recovery code.
 */
export async function adoptPasskeyKey(user: User, prf: BufferSource) {
  const key = await derivePasskeyKey(prf);
  passkeyKey = { userId: user.user_id, key };
  if (!user.near_account) return;
  if (await loadNearKey(user.user_id).catch(() => null)) return;
  if (await isFullAccessKey(user.near_account, key.publicKey)) await saveNearKey({ ...key, userId: user.user_id });
}

/**
 * When this browser holds the account's key and the passkey's key is not on the account yet, adds it once. From then
 * on every browser with the same passkey can sign. Best effort: a failure leaves things as they were.
 */
export function linkPasskeyKey(user: User) {
  const pending = passkeyKey;
  if (!pending || pending.userId !== user.user_id || !user.near_account) return Promise.resolve(false);
  const account = user.near_account;
  return serial(async () => {
    const local = await loadNearKey(user.user_id).catch(() => null);
    if (!local || local.publicKey === pending.key.publicKey) return false;
    if (await isFullAccessKey(account, pending.key.publicKey)) return false;
    await relayWith(account, local, (signer) => addFullAccessKey(signer, rawPublicKey(pending.key.publicKey)));
    return true;
  }).catch(() => false);
}

function relayWith(account: string, key: Key, build: Parameters<typeof submitDelegate>[1], onSubmitted?: Parameters<typeof submitDelegate>[2]) {
  return submitDelegate(
    {
      rpcUrl: RPC_URL,
      sender: account,
      publicKey: key.publicKey,
      sign: async (message) => new Uint8Array(await crypto.subtle.sign("Ed25519", key.privateKey, new Uint8Array(message))),
      relay: walletApi.relay,
      relayStatus: walletApi.relayStatus,
    },
    build,
    onSubmitted,
  );
}

/** True when this browser holds the key the user's NEAR account trusts, so it can sign vault calls. */
export async function hasDeviceKey(user: User) {
  if (!user.near_account) return false;
  return Boolean(await loadNearKey(user.user_id).catch(() => null));
}

/** Signs one vault call with this browser's device key and relays it, fliq paying the gas. */
export async function signAndRelay(user: User, build: Parameters<typeof submitDelegate>[1], onSubmitted?: (result: Awaited<ReturnType<typeof submitDelegate>>) => void) {
  const key = user.near_account ? await loadNearKey(user.user_id).catch(() => null) : null;
  if (!key || !user.near_account) throw new NoDeviceKeyError();
  const account = user.near_account;
  return serial(() => relayWith(account, key, build, onSubmitted));
}

export type { DelegateAction };
