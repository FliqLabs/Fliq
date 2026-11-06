import { randomBytes } from "node:crypto";
import { constantTimeEqual, hmac } from "./hmac.js";

export const SIGNATURE_HEADER = "fliq-signature";
export const EVENT_ID_HEADER = "fliq-event-id";
export const EVENT_TYPE_HEADER = "fliq-event-type";
export const DELIVERY_ID_HEADER = "fliq-delivery-id";
// ARCH §12.4: receivers reject a signature whose timestamp is more than five minutes away from their clock.
export const TOLERANCE_SECONDS = 300;

export function newSigningSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

// HMAC-SHA256 over "<unix seconds>.<raw body>", hex. One v1 per active secret, so a rotation overlaps.
export function signatureHeader(secrets: readonly string[], timestamp: number, body: string): string {
  const signed = `${timestamp}.${body}`;
  return [`t=${timestamp}`, ...secrets.map((secret) => `v1=${hmac("sha256", secret, signed, "hex")}`)].join(
    ",",
  );
}

// What a receiver does. Kept here so the tests and the docs example check the same thing the sender signs.
export function verifySignature(options: {
  header: string | undefined;
  body: string;
  secret: string;
  now: number;
}): boolean {
  if (!options.header) return false;
  const parts = options.header.split(",").map((part) => part.trim().split("=", 2) as [string, string]);
  const timestamp = Number(parts.find(([name]) => name === "t")?.[1]);
  if (!Number.isInteger(timestamp) || Math.abs(options.now - timestamp) > TOLERANCE_SECONDS) return false;
  const expected = hmac("sha256", options.secret, `${timestamp}.${options.body}`, "hex");
  return parts.some(
    ([name, value]) => name === "v1" && value !== undefined && constantTimeEqual(value, expected),
  );
}
