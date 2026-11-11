import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanAmount, formatMoney, formatRate, fromMinorUnits, toTokenUnits } from "../app/lib/money.ts";

test("amounts read the way the app shows them", () => {
  assert.equal(formatMoney(68816, "NGN"), "₦68,816");
  assert.equal(formatMoney("6450", "KES"), "KSh 6,450");
  assert.equal(formatMoney(602.5, "GHS"), "GH₵602.50");
  assert.equal(formatMoney("128.18", "USD"), "$128.18");
});

test("a rate keeps two decimals even where amounts have none", () => {
  assert.equal(formatRate(1376.32, "NGN"), "₦1,376.32");
  assert.equal(formatRate(129.26, "KES"), "KSh 129.26");
});

test("quote fees arrive in kobo and show in naira", () => {
  assert.equal(formatMoney(fromMinorUnits(25000 + 9400), "NGN"), "₦344");
});

test("typing an amount keeps one dot and two decimals", () => {
  assert.equal(cleanAmount("$1,200.509"), "1200.50");
  assert.equal(cleanAmount("007"), "7");
  assert.equal(cleanAmount(".5"), "0.5");
  assert.equal(cleanAmount("1.2.3"), "1.23");
});

test("dollars become USDC base units without a float", () => {
  assert.equal(toTokenUnits("25"), 25_000_000n);
  assert.equal(toTokenUnits("0.000001"), 1n);
  assert.equal(toTokenUnits("128.18"), 128_180_000n);
  assert.throws(() => toTokenUnits("1.0000001"));
  assert.throws(() => toTokenUnits("1e3"));
});
