import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt, keyedHash, parseKey } from "../packages/db/src/crypto.js";
import { newId, ulid } from "../packages/db/src/ids.js";

const key = randomBytes(32);

describe("encryption", () => {
  it("round-trips and uses a fresh iv each time", () => {
    const a = encrypt("0123456789", key);
    const b = encrypt("0123456789", key);
    expect(decrypt(a, key)).toBe("0123456789");
    expect(a.equals(b)).toBe(false);
  });

  it("rejects tampered ciphertext", () => {
    const sealed = encrypt("DARA OKONKWO", key);
    const last = sealed.length - 1;
    sealed.writeUInt8(sealed.readUInt8(last) ^ 1, last);
    expect(() => decrypt(sealed, key)).toThrow();
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => parseKey(Buffer.alloc(16).toString("base64"))).toThrow();
  });

  it("hashes deterministically under one key and differently under another", () => {
    expect(keyedHash("058:0123456789", key).equals(keyedHash("058:0123456789", key))).toBe(true);
    expect(keyedHash("058:0123456789", key).equals(keyedHash("058:0123456789", randomBytes(32)))).toBe(false);
  });
});

describe("ids", () => {
  it("makes 26 character ulids that sort by time", () => {
    const earlier = ulid(1_000);
    const later = ulid(2_000);
    expect(earlier).toHaveLength(26);
    expect(earlier < later).toBe(true);
  });

  it("prefixes ids", () => {
    expect(newId("usr")).toMatch(/^usr_[0-9a-z]{26}$/);
  });
});
