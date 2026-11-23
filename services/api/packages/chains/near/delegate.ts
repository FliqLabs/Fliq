import { createHash } from "node:crypto";
import { deserialize } from "borsh";
import { encodeDelegateAction, encodeSignedDelegate, KeyType, PublicKey, SCHEMA } from "near-api-js";

// A signed delegate (NEP-366) must stay small: one or a few function calls, never a contract upload.
export const MAX_SIGNED_DELEGATE_BYTES = 16 * 1024;

export type DelegatedCall = {
  methodName: string;
  args: Uint8Array;
  gas: bigint;
  deposit: bigint;
};

// The one thing besides a function call that can be relayed: a user adding a full-access key to, or removing a key
// from, an account. It is how a second iPhone or a recovery key gets onto the account without the user holding NEAR.
export type KeyChange = { kind: "add_full_access" | "delete"; publicKey: string };

export type VerifiedDelegate = {
  senderId: string;
  receiverId: string;
  // Empty when the delegate is a key change.
  calls: DelegatedCall[];
  keyChange?: KeyChange;
  nonce: bigint;
  maxBlockHeight: bigint;
  publicKey: string;
  // sha256 of the signed message: the same delegate always has the same hash, which makes relaying idempotent.
  hash: string;
  // Borsh SignedDelegate exactly as the client signed it, for wrapping into the relayer's transaction.
  raw: Uint8Array;
};

export class DelegateError extends Error {
  readonly code: "malformed" | "unsupported_action" | "bad_signature";

  constructor(code: DelegateError["code"], detail: string) {
    super(detail);
    this.name = "DelegateError";
    this.code = code;
  }
}

type BorshBytes = number[] | Uint8Array;
type DecodedAction = Record<string, unknown>;
type Decoded = {
  delegateAction: {
    senderId: string;
    receiverId: string;
    actions: DecodedAction[];
    nonce: bigint;
    maxBlockHeight: bigint;
    publicKey: { ed25519Key?: { data: BorshBytes }; secp256k1Key?: unknown };
  };
  signature: { ed25519Signature?: { data: BorshBytes } };
};

// Decodes with near-api-js's own Borsh schema and verifies the signature over the NEP-461 prefixed message,
// so the relayer and the chain read the same bytes the same way.
export function verifySignedDelegate(base64: string): VerifiedDelegate {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))
    throw new DelegateError("malformed", "signed delegate must be base64");
  const raw = new Uint8Array(Buffer.from(base64, "base64"));
  if (raw.length === 0 || raw.length > MAX_SIGNED_DELEGATE_BYTES) {
    throw new DelegateError("malformed", "signed delegate is empty or too large");
  }

  let decoded: Decoded;
  try {
    decoded = deserialize(SCHEMA.SignedDelegate, raw) as Decoded;
  } catch {
    throw new DelegateError("malformed", "signed delegate is not valid Borsh");
  }
  // Borsh decoding ignores trailing bytes, so require an exact round trip: what is relayed is exactly what was signed.
  const canonical = encodeSignedDelegate(decoded as unknown as Parameters<typeof encodeSignedDelegate>[0]);
  if (!Buffer.from(canonical).equals(Buffer.from(raw))) {
    throw new DelegateError("malformed", "signed delegate has trailing or non-canonical bytes");
  }
  const action = decoded.delegateAction;
  const keyBytes = action.publicKey.ed25519Key?.data;
  const signatureBytes = decoded.signature.ed25519Signature?.data;
  if (!keyBytes || !signatureBytes)
    throw new DelegateError("unsupported_action", "only ed25519 keys are accepted");

  const publicKey = new PublicKey({ keyType: KeyType.ED25519, data: Uint8Array.from(keyBytes) });
  const message = createHash("sha256")
    .update(encodeDelegateAction(action as unknown as Parameters<typeof encodeDelegateAction>[0]))
    .digest();
  if (!publicKey.verify(new Uint8Array(message), Uint8Array.from(signatureBytes))) {
    throw new DelegateError("bad_signature", "signature does not match the delegate action");
  }

  const keyChange = toKeyChange(action.actions);
  return {
    senderId: action.senderId,
    receiverId: action.receiverId,
    calls: keyChange ? [] : action.actions.map(toCall),
    ...(keyChange ? { keyChange } : {}),
    nonce: action.nonce,
    maxBlockHeight: action.maxBlockHeight,
    publicKey: publicKey.toString(),
    hash: message.toString("hex"),
    raw,
  };
}

type DecodedKey = { ed25519Key?: { data: BorshBytes } };

function ed25519Key(key: DecodedKey | undefined): string {
  const data = key?.ed25519Key?.data;
  if (!data) throw new DelegateError("unsupported_action", "only ed25519 keys can be added or removed");
  return new PublicKey({ keyType: KeyType.ED25519, data: Uint8Array.from(data) }).toString();
}

// A key change travels alone: mixed with anything else it is refused by toCall like any other non-call action.
function toKeyChange(actions: DecodedAction[]): KeyChange | null {
  const action = actions[0];
  if (actions.length !== 1 || !action || Object.keys(action).length !== 1) return null;
  if (action.deleteKey) {
    return { kind: "delete", publicKey: ed25519Key((action.deleteKey as { publicKey?: DecodedKey }).publicKey) };
  }
  if (!action.addKey) return null;
  const added = action.addKey as { publicKey?: DecodedKey; accessKey?: { nonce?: bigint; permission?: Record<string, unknown> } };
  const permission = Object.keys(added.accessKey?.permission ?? {});
  if (permission.length !== 1 || permission[0] !== "fullAccess") {
    throw new DelegateError("unsupported_action", "only a full-access key can be added by relay");
  }
  if (BigInt(added.accessKey?.nonce ?? 0n) !== 0n) {
    throw new DelegateError("unsupported_action", "a new key must start at nonce 0");
  }
  return { kind: "add_full_access", publicKey: ed25519Key(added.publicKey) };
}

function toCall(action: DecodedAction): DelegatedCall {
  const call = action.functionCall as
    | { methodName: string; args: BorshBytes; gas: bigint; deposit: bigint }
    | undefined;
  if (!call || Object.keys(action).length !== 1) {
    throw new DelegateError(
      "unsupported_action",
      `only function calls can be relayed, got ${Object.keys(action).join(",")}`,
    );
  }
  return {
    methodName: call.methodName,
    args: Uint8Array.from(call.args),
    gas: call.gas,
    deposit: call.deposit,
  };
}
