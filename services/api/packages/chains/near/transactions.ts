import { deserialize } from "borsh";
import {
  actions,
  baseDecode,
  baseEncode,
  createTransaction,
  encodeSignedDelegate,
  encodeTransaction,
  KeyPair,
  KeyPairSigner,
  PublicKey,
  SCHEMA,
} from "near-api-js";
import type { Action } from "near-api-js";

const TGAS = 1_000_000_000_000n;
export const STORAGE_DEPOSIT_GAS = 30n * TGAS;

export type SigningKey = { accountId: string; privateKey: string };

export type SignedTx = { txHash: string; base64: string };

type TxParams = {
  signer: SigningKey;
  receiverId: string;
  nonce: bigint;
  blockHash: string;
  actions: Action[];
};

export function publicKeyOf(privateKey: string): string {
  return KeyPair.fromString(privateKey as Parameters<typeof KeyPair.fromString>[0])
    .getPublicKey()
    .toString();
}

// The transaction hash is known before sending, so an unknown outcome can always be looked up later.
export async function signTransaction(params: TxParams): Promise<SignedTx> {
  const keyPair = KeyPair.fromString(params.signer.privateKey as Parameters<typeof KeyPair.fromString>[0]);
  const transaction = createTransaction(
    params.signer.accountId,
    keyPair.getPublicKey(),
    params.receiverId,
    params.nonce,
    params.actions,
    baseDecode(params.blockHash),
  );
  const { txHash, signedTransaction } = await new KeyPairSigner(keyPair).signTransaction(transaction);
  return {
    txHash: baseEncode(txHash),
    base64: Buffer.from(encodeTransaction(signedTransaction)).toString("base64"),
  };
}

// Wraps the user's signed delegate unchanged; the guard proves the bytes sent are the bytes the user signed.
export function relayActions(rawSignedDelegate: Uint8Array): Action[] {
  const decoded = deserialize(SCHEMA.SignedDelegate, rawSignedDelegate) as Parameters<
    typeof actions.signedDelegate
  >[0];
  if (!Buffer.from(encodeSignedDelegate(decoded)).equals(Buffer.from(rawSignedDelegate))) {
    throw new Error("signed delegate does not re-encode to the bytes the user signed");
  }
  return [actions.signedDelegate(decoded)];
}

// A new user's account: created by the root account, owned only by the user's own key.
export function createAccountActions(userPublicKey: string, fundingYocto: bigint): Action[] {
  const key = PublicKey.fromString(userPublicKey);
  return [
    actions.createAccount(),
    ...(fundingYocto > 0n ? [actions.transfer(fundingYocto)] : []),
    actions.addFullAccessKey(key),
  ];
}

export function transferActions(yocto: bigint): Action[] {
  return [actions.transfer(yocto)];
}

export function functionCallActions(method: string, args: object, gasTgas: bigint, depositYocto = 0n): Action[] {
  return [actions.functionCall(method, args, gasTgas * TGAS, depositYocto)];
}

export function storageDepositActions(accountId: string, depositYocto: bigint): Action[] {
  return [
    actions.functionCall(
      "storage_deposit",
      { account_id: accountId, registration_only: true },
      STORAGE_DEPOSIT_GAS,
      depositYocto,
    ),
  ];
}
