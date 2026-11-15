import assert from "node:assert/strict";
import { test } from "node:test";
import { asBankActivity, bankActivityItem, compareDecimals, formatNaira, isBankSource, isPositiveDecimal, parseNaira } from "../app/lib/paj.ts";

test("decimal comparisons do not use binary floating point", () => {
  assert.equal(compareDecimals("0.1", "0.10"), 0);
  assert.equal(compareDecimals("72.660000", "72.66"), 0);
  assert.equal(compareDecimals("999999999999999999.99", "1000000000000000000"), -1);
  assert.equal(isPositiveDecimal("0.01"), true);
  assert.equal(isPositiveDecimal("0"), false);
  assert.equal(isPositiveDecimal("1e3"), false);
  assert.equal(isPositiveDecimal("-100"), false);
});

test("Naira display uses separators and keeps valid decimals", () => {
  assert.equal(formatNaira("100000"), "₦100,000");
  assert.equal(formatNaira("1376.32"), "₦1,376.32");
  assert.equal(formatNaira("not-money"), "₦—");
});

test("Naira input rejects signs, exponents and malformed grouping", () => {
  assert.equal(parseNaira("-100"), "");
  assert.equal(parseNaira("1e3"), "");
  assert.equal(parseNaira("1,2,3"), "");
  assert.equal(parseNaira("100,000"), "100000");
  assert.equal(parseNaira(""), "");
});

test("bank records are labelled from your bank and API status wins", () => {
  const record = { depositId: "dep_1", naira: "100000", usdc: "72.66", startedAt: "2026-11-15T12:00:00.000Z" };
  const pending = bankActivityItem(record);
  assert.equal(pending.party.name, "From your bank");
  assert.equal(pending.status, "pending");
  const listed = asBankActivity({ ...pending, activity_id: "api-1", status: "received", usd: "72.65", party: { ...pending.party, name: "Received from Solana" } }, record);
  assert.equal(listed.party.name, "From your bank");
  assert.equal(listed.status, "received");
  assert.equal(listed.usd, "72.65");
});

test("only an available USDC Solana source is eligible for Paj", () => {
  const source = { token: "usdc", chain: "solana", group: "dollars", minimum: "1", eta_seconds: 35, direct: false, available: true, address: null };
  assert.equal(isBankSource(source), true);
  assert.equal(isBankSource({ ...source, available: false }), false);
  assert.equal(isBankSource({ ...source, chain: "base" }), false);
  assert.equal(isBankSource({ ...source, token: "usdt" }), false);
});
