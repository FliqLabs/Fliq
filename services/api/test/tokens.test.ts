import { describe, expect, it } from "vitest";
import { ACCESS_TTL_SECONDS, hashToken, newOpaqueToken, signAccessToken, verifyAccessToken } from "../apps/api/src/auth/tokens.js";

const secret = "test-secret";

describe("access tokens", () => {
  it("verifies a fresh token", () => {
    const token = signAccessToken("usr_1", "ses_1", secret, 1_000);
    expect(verifyAccessToken(token, secret, 1_001)).toMatchObject({ sub: "usr_1", fam: "ses_1" });
  });

  it("rejects expiry, a wrong secret and a tampered payload", () => {
    const token = signAccessToken("usr_1", "ses_1", secret, 1_000);
    expect(verifyAccessToken(token, secret, 1_000 + ACCESS_TTL_SECONDS)).toBeNull();
    expect(verifyAccessToken(token, "other", 1_001)).toBeNull();
    const [header, , signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "usr_2", fam: "ses_1", exp: 9_999_999_999 })).toString("base64url");
    expect(verifyAccessToken(`${header}.${forged}.${signature}`, secret, 1_001)).toBeNull();
  });
});

describe("opaque tokens", () => {
  it("returns a token whose stored hash matches", () => {
    const { token, hash } = newOpaqueToken("rf");
    expect(token.startsWith("rf_")).toBe(true);
    expect(hashToken(token)).toBe(hash);
  });
});
