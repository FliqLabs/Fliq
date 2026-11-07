import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { newSigningSecret, signatureHeader, verifySignature } from "./signature.js";

const body = JSON.stringify({ id: "evt_1", type: "payout.settled" });

describe("outbound webhook signatures", () => {
  it("signs t.body with HMAC-SHA256, hex, the way the docs describe", () => {
    const header = signatureHeader(["whsec_a"], 1_730_000_000, body);
    const expected = createHmac("sha256", "whsec_a").update(`1730000000.${body}`).digest("hex");
    expect(header).toBe(`t=1730000000,v1=${expected}`);
  });

  it("verifies within the five-minute tolerance and refuses outside it", () => {
    const header = signatureHeader(["whsec_a"], 1_000, body);
    expect(verifySignature({ header, body, secret: "whsec_a", now: 1_300 })).toBe(true);
    expect(verifySignature({ header, body, secret: "whsec_a", now: 1_301 })).toBe(false);
    expect(verifySignature({ header, body: `${body} `, secret: "whsec_a", now: 1_000 })).toBe(false);
    expect(verifySignature({ header, body, secret: "whsec_b", now: 1_000 })).toBe(false);
    expect(verifySignature({ header: undefined, body, secret: "whsec_a", now: 1_000 })).toBe(false);
  });

  it("carries one signature per secret during a rotation, so either secret verifies", () => {
    const header = signatureHeader(["whsec_new", "whsec_old"], 1_000, body);
    expect(verifySignature({ header, body, secret: "whsec_new", now: 1_000 })).toBe(true);
    expect(verifySignature({ header, body, secret: "whsec_old", now: 1_000 })).toBe(true);
  });

  it("makes 32-byte secrets with a readable prefix", () => {
    expect(newSigningSecret()).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(newSigningSecret()).not.toBe(newSigningSecret());
  });
});
