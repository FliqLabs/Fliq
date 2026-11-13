import { base58Decode, base58Encode } from "./base58.js";

// NEP-461: a delegate action is signed over sha256(u32 LE (2^30 + 366) ‖ borsh(DelegateAction)).
const DELEGATE_PREFIX = 2 ** 30 + 366;
const FUNCTION_CALL_ACTION = 2;
const ED25519 = 0;

export interface AgentKey {
  accountId: string;
  publicKey: Uint8Array;
  sign: (message: Uint8Array) => Promise<Uint8Array>;
}

export interface FunctionCall {
  receiverId: string;
  methodName: string;
  args: Record<string, unknown>;
  gas: bigint;
  deposit: bigint;
}

export interface DelegateInput {
  call: FunctionCall;
  nonce: bigint;
  maxBlockHeight: bigint;
}

// "ed25519:<base58 of 64 bytes>", the NEAR CLI and near-api-js format: a 32-byte seed followed by the public key.
export async function agentKeyFrom(accountId: string, secretKey: string): Promise<AgentKey> {
  const [curve, encoded] = secretKey.split(":");
  const bytes = curve === "ed25519" && encoded ? base58Decode(encoded) : new Uint8Array();
  if (bytes.length !== 64)
    throw new Error("The agent key must be an ed25519:<base58> secret key of 64 bytes.");
  const seed = bytes.slice(0, 32);
  const publicKey = bytes.slice(32);
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "OKP", crv: "Ed25519", d: base64url(seed), x: base64url(publicKey) },
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  return {
    accountId,
    publicKey,
    sign: async (message) => new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key, message)),
  };
}

// A fresh key in the same format agentKeyFrom reads, for `fliq-mcp keygen`.
export async function generateAgentKey(): Promise<{ secretKey: string; publicKey: string }> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const seed = fromBase64url(jwk.d as string);
  const publicKey = fromBase64url(jwk.x as string);
  return { secretKey: `ed25519:${base58Encode(join(seed, publicKey))}`, publicKey: publicKeyText(publicKey) };
}

export function publicKeyText(publicKey: Uint8Array): string {
  return `ed25519:${base58Encode(publicKey)}`;
}

// Returns the base64 Borsh SignedDelegate that POST /relays takes, and the hash the relayer files it under.
export async function signDelegate(
  agent: AgentKey,
  input: DelegateInput,
): Promise<{ signedDelegate: string; hash: string }> {
  const action = delegateAction(agent, input);
  const prefix = new Writer().u32(DELEGATE_PREFIX).bytes();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", join(prefix, action)));
  const signature = await agent.sign(digest);
  const signed = join(action, new Writer().u8(ED25519).raw(signature).bytes());
  return { signedDelegate: base64(signed), hash: hex(digest) };
}

function delegateAction(agent: AgentKey, input: DelegateInput): Uint8Array {
  const { call } = input;
  return new Writer()
    .string(agent.accountId)
    .string(call.receiverId)
    .u32(1)
    .u8(FUNCTION_CALL_ACTION)
    .string(call.methodName)
    .vec(new TextEncoder().encode(JSON.stringify(call.args)))
    .u64(call.gas)
    .u128(call.deposit)
    .u64(input.nonce)
    .u64(input.maxBlockHeight)
    .u8(ED25519)
    .raw(agent.publicKey)
    .bytes();
}

class Writer {
  private readonly parts: number[] = [];

  u8(value: number): this {
    this.parts.push(value & 0xff);
    return this;
  }

  u32(value: number): this {
    return this.little(BigInt(value), 4);
  }

  u64(value: bigint): this {
    return this.little(value, 8);
  }

  u128(value: bigint): this {
    return this.little(value, 16);
  }

  raw(bytes: Uint8Array): this {
    this.parts.push(...bytes);
    return this;
  }

  vec(bytes: Uint8Array): this {
    return this.u32(bytes.length).raw(bytes);
  }

  string(text: string): this {
    return this.vec(new TextEncoder().encode(text));
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.parts);
  }

  private little(value: bigint, size: number): this {
    for (let i = 0; i < size; i++) this.parts.push(Number((value >> BigInt(8 * i)) & 0xffn));
    return this;
  }
}

function join(first: Uint8Array, second: Uint8Array): Uint8Array {
  const joined = new Uint8Array(first.length + second.length);
  joined.set(first);
  joined.set(second, first.length);
  return joined;
}

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64url(bytes: Uint8Array): string {
  return base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array {
  return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
