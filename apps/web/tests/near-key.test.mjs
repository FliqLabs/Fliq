import assert from "node:assert/strict";
import { test } from "node:test";
import { createNearKey, recoverNearKey } from "../app/claim-name/near-key.ts";

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function decodeBase58(value) {
  let number = 0n;
  for (const character of value) number = number * 58n + BigInt(alphabet.indexOf(character));
  const bytes = [];
  while (number > 0n) {
    bytes.unshift(Number(number % 256n));
    number /= 256n;
  }
  return Buffer.from([...Array(value.match(/^1*/)[0].length).fill(0), ...bytes]);
}

test("a recovery code restores the same NEAR signing key", async () => {
  globalThis.indexedDB = {};
  const created = await createNearKey();
  const restored = await recoverNearKey(created.recoveryCode);
  const payload = Buffer.from(created.recoveryCode.slice("fliq-".length), "base64url");
  const publicBytes = payload.subarray(33, 65);

  assert.equal(created.publicKey, restored.publicKey);
  assert.deepEqual(decodeBase58(created.publicKey.slice("ed25519:".length)), publicBytes);
  assert.equal(created.privateKey.extractable, false);
  assert.equal(restored.privateKey.extractable, false);

  const message = new TextEncoder().encode("fliq recovery test");
  const originalSignature = await crypto.subtle.sign("Ed25519", created.privateKey, message);
  const recoveredSignature = await crypto.subtle.sign("Ed25519", restored.privateKey, message);
  assert.deepEqual(Buffer.from(originalSignature), Buffer.from(recoveredSignature));
});

test("a changed recovery code is rejected", async () => {
  globalThis.indexedDB = {};
  const created = await createNearKey();
  const code = created.recoveryCode;
  const changed = code.slice(0, 20) + (code[20] === "A" ? "B" : "A") + code.slice(21);
  await assert.rejects(recoverNearKey(changed), /typo/);
});
