import { createHmac, randomBytes } from "node:crypto";
import { safeEqual, sha256Hex } from "../../../../packages/db/src/crypto.js";

export const ACCESS_TTL_SECONDS = 900;
export const REFRESH_TTL_SECONDS = 30 * 24 * 3600;
export const EMAIL_LINK_TTL_SECONDS = 900;

export interface AccessClaims {
  sub: string;
  fam: string;
  exp: number;
}

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const HEADER = encode({ alg: "HS256", typ: "JWT" });

function sign(unsigned: string, secret: string): string {
  return createHmac("sha256", secret).update(unsigned).digest("base64url");
}

export function signAccessToken(userId: string, familyId: string, secret: string, nowSeconds: number): string {
  const claims: AccessClaims = { sub: userId, fam: familyId, exp: nowSeconds + ACCESS_TTL_SECONDS };
  const unsigned = `${HEADER}.${encode(claims)}`;
  return `${unsigned}.${sign(unsigned, secret)}`;
}

export function verifyAccessToken(token: string, secret: string, nowSeconds: number): AccessClaims | null {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) return null;
  if (!safeEqual(signature, sign(`${header}.${payload}`, secret))) return null;
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AccessClaims;
  return claims.exp > nowSeconds ? claims : null;
}

export function newOpaqueToken(prefix: string): { token: string; hash: string } {
  const token = `${prefix}_${randomBytes(32).toString("base64url")}`;
  return { token, hash: sha256Hex(token) };
}

export const hashToken = sha256Hex;
