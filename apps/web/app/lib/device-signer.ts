"use client";

import { loadNearKey } from "../claim-name/near-key";
import { submitDelegate, type DelegateAction } from "./near-delegate";
import { walletApi, type User } from "./wallet-api";

const RPC_URL = process.env.NEXT_PUBLIC_NEAR_RPC_URL ?? "https://rpc.testnet.near.org";

export class NoDeviceKeyError extends Error {
  constructor() {
    super("This browser has no signing key for your account yet. Restore it with your recovery code in Account.");
  }
}

/** True when this browser holds the key the user's NEAR account trusts, so it can sign vault calls. */
export async function hasDeviceKey(user: User) {
  if (!user.near_account) return false;
  return Boolean(await loadNearKey(user.user_id).catch(() => null));
}

/** Signs one vault call with this browser's device key and relays it, fliq paying the gas. */
export async function signAndRelay(user: User, build: Parameters<typeof submitDelegate>[1]) {
  const key = user.near_account ? await loadNearKey(user.user_id).catch(() => null) : null;
  if (!key || !user.near_account) throw new NoDeviceKeyError();
  return submitDelegate(
    {
      rpcUrl: RPC_URL,
      sender: user.near_account,
      publicKey: key.publicKey,
      sign: async (message) => new Uint8Array(await crypto.subtle.sign("Ed25519", key.privateKey, new Uint8Array(message))),
      relay: walletApi.relay,
      relayStatus: walletApi.relayStatus,
    },
    build,
  );
}

export type { DelegateAction };
