import { isRecord } from "./errors.js";
import type { WebhookEvent } from "./types.js";

export const WEBHOOK_SIGNATURE_HEADER = "fliq-signature";
export const WEBHOOK_EVENT_ID_HEADER = "fliq-event-id";
export const WEBHOOK_EVENT_TYPE_HEADER = "fliq-event-type";
export const WEBHOOK_DELIVERY_ID_HEADER = "fliq-delivery-id";
export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

export type WebhookHeaders = Headers | Record<string, string | readonly string[] | undefined>;

export type WebhookFailure =
  | "missing_signature"
  | "malformed_signature"
  | "timestamp_out_of_tolerance"
  | "signature_mismatch"
  | "invalid_payload";

export class WebhookVerificationError extends Error {
  override readonly name = "WebhookVerificationError";

  constructor(
    readonly reason: WebhookFailure,
    message: string,
  ) {
    super(message);
  }
}

export interface VerifyWebhookOptions {
  toleranceSeconds?: number;
  // Unix seconds. Tests pass a fixed clock; everyone else leaves it out.
  now?: number;
}

const encoder = new TextEncoder();

// Checks a delivery exactly as the API signs it: HMAC-SHA256, hex, over "<t>.<raw body>", with one v1 value per
// active endpoint secret during a rotation. Pass several secrets to accept your own rotation overlap too.
export async function verifyWebhook(
  rawBody: string | Uint8Array,
  headers: WebhookHeaders,
  secret: string | readonly string[],
  options: VerifyWebhookOptions = {},
): Promise<WebhookEvent> {
  const tolerance = options.toleranceSeconds ?? DEFAULT_WEBHOOK_TOLERANCE_SECONDS;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const header = headerValue(headers, WEBHOOK_SIGNATURE_HEADER);
  if (!header)
    throw new WebhookVerificationError("missing_signature", `No ${WEBHOOK_SIGNATURE_HEADER} header.`);

  const { timestamp, signatures } = parseSignatureHeader(header);
  if (Math.abs(now - timestamp) > tolerance) {
    throw new WebhookVerificationError(
      "timestamp_out_of_tolerance",
      "The signature timestamp is too far from now.",
    );
  }

  const body = typeof rawBody === "string" ? encoder.encode(rawBody) : rawBody;
  const signed = concat(encoder.encode(`${timestamp}.`), body);
  const secrets = typeof secret === "string" ? [secret] : secret;
  for (const candidate of secrets) {
    const expected = await hmacSha256Hex(candidate, signed);
    if (signatures.some((signature) => constantTimeEqual(signature, expected))) return parseEvent(body);
  }
  throw new WebhookVerificationError("signature_mismatch", "No signature matches the secret.");
}

function parseSignatureHeader(header: string): { timestamp: number; signatures: string[] } {
  const pairs = header.split(",").map((part) => {
    const trimmed = part.trim();
    const at = trimmed.indexOf("=");
    return at < 0 ? ["", ""] : [trimmed.slice(0, at), trimmed.slice(at + 1)];
  });
  const timestamp = Number(pairs.find(([name]) => name === "t")?.[1]);
  const signatures = pairs
    .filter(([name, value]) => name === "v1" && value)
    .map(([, value]) => value as string);
  if (!Number.isInteger(timestamp) || signatures.length === 0) {
    throw new WebhookVerificationError(
      "malformed_signature",
      "The signature header needs t and at least one v1.",
    );
  }
  return { timestamp, signatures };
}

function headerValue(headers: WebhookHeaders, name: string): string | undefined {
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name) ?? undefined;
  const record = headers as Record<string, string | readonly string[] | undefined>;
  const key = Object.keys(record).find((candidate) => candidate.toLowerCase() === name);
  const value = key === undefined ? undefined : record[key];
  return typeof value === "string" ? value : value?.[0];
}

async function hmacSha256Hex(secret: string, payload: Uint8Array): Promise<string> {
  const key = await webCrypto().subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await webCrypto().subtle.sign("HMAC", key, payload));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Lowercase hex on both sides; a length difference reveals nothing an attacker does not already know.
function constantTimeEqual(received: string, expected: string): boolean {
  const left = received.toLowerCase();
  if (left.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

function concat(first: Uint8Array, second: Uint8Array): Uint8Array {
  const joined = new Uint8Array(first.length + second.length);
  joined.set(first);
  joined.set(second, first.length);
  return joined;
}

function parseEvent(body: Uint8Array): WebhookEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new WebhookVerificationError("invalid_payload", "The body is not JSON.");
  }
  if (!isRecord(parsed) || typeof parsed.id !== "string" || typeof parsed.type !== "string") {
    throw new WebhookVerificationError("invalid_payload", "The body is not a fliq event.");
  }
  return parsed as WebhookEvent;
}

export function webCrypto(): Crypto {
  const crypto = globalThis.crypto;
  if (!crypto?.subtle) {
    throw new Error(
      "Web Crypto is not available. On Node 18 start node with --experimental-global-webcrypto.",
    );
  }
  return crypto;
}
