import { describe, expect, it } from "vitest";
import { hmac, verifyHmac } from "./hmac";

describe("hmac", () => {
  it("matches the RFC 4231 test case 2 for HMAC-SHA256", () => {
    expect(hmac("sha256", "Jefe", "what do ya want for nothing?", "hex")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });

  it("accepts the current or previous secret during rotation", () => {
    const payload = '{"id":1}';
    const signature = hmac("sha256", "old", payload, "hex");
    const base = { algorithm: "sha256", encoding: "hex", payload, signature } as const;
    expect(verifyHmac({ ...base, secrets: ["new", "old"] })).toBe(true);
    expect(verifyHmac({ ...base, secrets: ["new"] })).toBe(false);
  });

  it("rejects a missing or altered signature", () => {
    const payload = "body";
    const signature = hmac("sha512", "s", payload, "base64");
    const base = { algorithm: "sha512", encoding: "base64", secrets: ["s"], payload } as const;
    expect(verifyHmac({ ...base, signature })).toBe(true);
    expect(verifyHmac({ ...base, signature: undefined })).toBe(false);
    expect(verifyHmac({ ...base, payload: "body ", signature })).toBe(false);
  });
});
