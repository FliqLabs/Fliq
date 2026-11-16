import assert from "node:assert/strict";
import { test } from "node:test";
import { walletAddress, walletAddressError } from "../app/lib/wallet-send-address.ts";

test("a Base address under Solana is refused before quoting", () => {
  assert.match(walletAddressError(`0x${"a".repeat(40)}`, "solana"), /Choose Base/);
});

test("Solana addresses keep their case and must decode to 32 bytes", () => {
  const address = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
  assert.equal(walletAddress(address, "solana"), address);
  assert.equal(walletAddressError(address, "solana"), null);
  assert.match(walletAddressError("1111111111111111111111111111111", "solana"), /isn't a Solana/);
});

test("NEAR names are lowercased and Base requires an EVM address", () => {
  assert.equal(walletAddress(" Alice.NEAR ", "near"), "alice.near");
  assert.equal(walletAddressError("alice.near", "near"), null);
  assert.equal(walletAddressError(`0x${"A".repeat(40)}`, "base"), null);
  assert.match(walletAddressError("alice.near", "base"), /isn't a Base/);
});
