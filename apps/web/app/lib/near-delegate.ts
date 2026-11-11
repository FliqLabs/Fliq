/* NEP-366 delegate actions signed in the browser with the device key, the same bytes the iOS app sends to
   POST /relays. Self-contained so the node tests can import it without a bundler. */

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** NEP-461 puts this before the action, so a signed delegate can never be replayed as a transaction. */
const SIGNING_PREFIX = 2 ** 30 + 366;
const FUNCTION_CALL = 2;
const ED25519 = 0;
/** The relayer only passes about ten minutes of blocks, and refuses more than 1,200. */
export const LIFETIME_BLOCKS = 600n;

export type DelegateAction = {
  senderId: string;
  receiverId: string;
  methodName: string;
  args: Uint8Array;
  gas: bigint;
  deposit: bigint;
  nonce: bigint;
  maxBlockHeight: bigint;
  publicKey: Uint8Array;
};

export type SignStep = {
  kind: "create_account" | "function_call";
  receiver_id: string;
  method_name: string | null;
  args: Record<string, unknown> | null;
  gas: string | null;
  deposit: string;
  public_key: string | null;
};

export type RelayResult = {
  status: "succeeded" | "failed" | "pending";
  tx_hash?: string | null;
  delegate_hash: string;
  sender_id: string;
  receiver_id: string;
  failures?: string[];
};

export function decodeBase58(value: string): Uint8Array {
  let number = 0n;
  for (const character of value) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) throw new Error("Not a base58 string.");
    number = number * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (number > 0n) {
    bytes.unshift(Number(number % 256n));
    number /= 256n;
  }
  const zeros = value.match(/^1*/)?.[0].length ?? 0;
  return Uint8Array.from([...new Array(zeros).fill(0), ...bytes]);
}

/** "ed25519:<base58>" to the raw 32 byte key. */
export function rawPublicKey(publicKey: string): Uint8Array {
  const [curve, encoded] = publicKey.split(":");
  const bytes = curve === "ed25519" && encoded ? decodeBase58(encoded) : new Uint8Array();
  if (bytes.length !== 32) throw new Error("Not an ed25519 public key.");
  return bytes;
}

function writer() {
  const parts: number[] = [];
  const unsigned = (value: bigint, size: number) => {
    let rest = value;
    for (let index = 0; index < size; index++) {
      parts.push(Number(rest & 0xffn));
      rest >>= 8n;
    }
  };
  return {
    u8: (value: number) => parts.push(value & 0xff),
    u32: (value: number) => unsigned(BigInt(value), 4),
    u64: (value: bigint) => unsigned(value, 8),
    u128: (value: bigint) => unsigned(value, 16),
    raw: (bytes: Uint8Array) => parts.push(...bytes),
    bytes(bytes: Uint8Array) {
      this.u32(bytes.length);
      this.raw(bytes);
    },
    string(value: string) {
      this.bytes(new TextEncoder().encode(value));
    },
    done: () => Uint8Array.from(parts),
  };
}

export function encodeDelegateAction(action: DelegateAction): Uint8Array {
  const out = writer();
  out.string(action.senderId);
  out.string(action.receiverId);
  out.u32(1);
  out.u8(FUNCTION_CALL);
  out.string(action.methodName);
  out.bytes(action.args);
  out.u64(action.gas);
  out.u128(action.deposit);
  out.u64(action.nonce);
  out.u64(action.maxBlockHeight);
  out.u8(ED25519);
  out.raw(action.publicKey);
  return out.done();
}

/** What the device key signs: sha256 of the NEP-461 prefix and the action. */
export async function signingHash(action: DelegateAction): Promise<Uint8Array> {
  const out = writer();
  out.u32(SIGNING_PREFIX);
  out.raw(encodeDelegateAction(action));
  return new Uint8Array(await crypto.subtle.digest("SHA-256", out.done()));
}

/** The Borsh SignedDelegate POST /relays takes, base64 encoded. */
export function encodeSignedDelegate(action: DelegateAction, signature: Uint8Array): string {
  const out = writer();
  out.raw(encodeDelegateAction(action));
  out.u8(ED25519);
  out.raw(signature);
  let binary = "";
  for (const byte of out.done()) binary += String.fromCharCode(byte);
  return btoa(binary);
}

type Signer = { sender: string; publicKey: Uint8Array; nonce: bigint; blockHeight: bigint };

/** Vault to vault between fliq users. The vault takes exactly one yoctoNEAR, so only a full-access key can move money. */
export function vaultTransfer(signer: Signer, vault: string, recipient: string, units: bigint): DelegateAction {
  return {
    senderId: signer.sender,
    receiverId: vault,
    methodName: "transfer",
    args: new TextEncoder().encode(`{"to_account":"${recipient}","amount":"${units}"}`),
    gas: 30_000_000_000_000n,
    deposit: 1n,
    nonce: signer.nonce,
    maxBlockHeight: signer.blockHeight + LIFETIME_BLOCKS,
    publicKey: signer.publicKey,
  };
}

/** A call the API asked the browser to sign, such as the vault's set_agent or remove_agent. */
export function stepAction(signer: Signer, step: SignStep): DelegateAction {
  if (step.kind !== "function_call" || !step.method_name) throw new Error("Only function calls are signed here.");
  return {
    senderId: signer.sender,
    receiverId: step.receiver_id,
    methodName: step.method_name,
    args: new TextEncoder().encode(JSON.stringify(step.args ?? {})),
    gas: BigInt(step.gas ?? "30000000000000"),
    deposit: BigInt(step.deposit),
    nonce: signer.nonce,
    maxBlockHeight: signer.blockHeight + LIFETIME_BLOCKS,
    publicKey: signer.publicKey,
  };
}

async function rpc<T>(url: string, method: string, params: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "fliq-web", method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("NEAR is not answering. Try again in a moment.");
  const body = await response.json();
  if (body.error || body.result?.error) {
    const detail = String(body.error?.cause?.name ?? body.result?.error ?? "");
    throw new Error(
      detail.includes("does not exist") || detail.includes("UNKNOWN_ACCESS_KEY")
        ? "This browser's key is not on your NEAR account. Restore it with your recovery code."
        : "NEAR could not read your account. Try again in a moment.",
    );
  }
  return body.result as T;
}

export type DelegateDeps = {
  rpcUrl: string;
  sender: string;
  publicKey: string;
  sign: (message: Uint8Array) => Promise<Uint8Array>;
  relay: (signedDelegate: string) => Promise<RelayResult>;
  relayStatus: (delegateHash: string) => Promise<RelayResult>;
  pollMs?: number;
  pollAttempts?: number;
};

/** Signs one call, hands it to the relayer and follows it until the chain answers. */
export async function submitDelegate(
  deps: DelegateDeps,
  build: (signer: Signer) => DelegateAction,
): Promise<RelayResult> {
  const [key, block] = await Promise.all([
    rpc<{ nonce: number }>(deps.rpcUrl, "query", {
      request_type: "view_access_key",
      finality: "final",
      account_id: deps.sender,
      public_key: deps.publicKey,
    }),
    rpc<{ header: { height: number } }>(deps.rpcUrl, "block", { finality: "final" }),
  ]);
  const action = build({
    sender: deps.sender,
    publicKey: rawPublicKey(deps.publicKey),
    nonce: BigInt(key.nonce) + 1n,
    blockHeight: BigInt(block.header.height),
  });
  const signature = await deps.sign(await signingHash(action));
  let result = await deps.relay(encodeSignedDelegate(action, signature));
  for (let attempt = 0; attempt < (deps.pollAttempts ?? 20) && result.status === "pending"; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, deps.pollMs ?? 1500));
    result = await deps.relayStatus(result.delegate_hash);
  }
  if (result.status === "failed") throw new Error(result.failures?.[0] ?? "The vault refused this.");
  if (result.status === "pending") throw new Error("NEAR is still working on it. Check Activity in a minute.");
  return result;
}
