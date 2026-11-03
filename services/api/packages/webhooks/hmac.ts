import { createHmac, timingSafeEqual } from "node:crypto";

export type HmacAlgorithm = "sha256" | "sha512";
export type SignatureEncoding = "hex" | "base64";

export function hmac(
  algorithm: HmacAlgorithm,
  secret: string,
  payload: string,
  encoding: SignatureEncoding,
): string {
  return createHmac(algorithm, secret).update(payload, "utf8").digest(encoding);
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

// Several secrets are accepted so a rotation can overlap current and previous for 24 h (ARCH §16.2).
export function verifyHmac(options: {
  algorithm: HmacAlgorithm;
  encoding: SignatureEncoding;
  secrets: readonly string[];
  payload: string;
  signature: string | undefined;
}): boolean {
  const { signature } = options;
  if (!signature) return false;
  const received = options.encoding === "hex" ? signature.trim().toLowerCase() : signature.trim();
  return options.secrets.some((secret) =>
    constantTimeEqual(hmac(options.algorithm, secret, options.payload, options.encoding), received),
  );
}
