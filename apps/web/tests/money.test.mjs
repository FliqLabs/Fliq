import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareDecimal,
  cleanAmount,
  formatMoney,
  formatRate,
  fromMinorUnits,
  isValidExchangeRate,
  localToUsd,
  parseAmountInput,
  quoteAmountForInput,
  subtractDecimal,
  toTokenUnits,
  usdToLocal,
  usdToLocalFloor,
} from "../app/lib/money.ts";

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

test("local amounts round up to the next USDC cent", () => {
  assert.equal(localToUsd("100000", "1376.32"), "72.66");
  assert.equal(localToUsd("100000.01", "1376.32"), "72.66");
  assert.equal(localToUsd("1", "3"), "0.34");
});

test("currency switching keeps a stable USDC equivalent", () => {
  const usd = localToUsd("100000", "1376.32");
  assert.equal(usd, "72.66");
  const local = usdToLocal(usd, "1376.32", "NGN");
  assert.equal(local, "100003");
  assert.equal(localToUsd(local, "1376.32"), usd);
  assert.equal(usdToLocal(usd, "1400", "NGN"), "101724");
});

test("invalid, zero, negative, and unavailable rates never convert", () => {
  assert.equal(localToUsd("", "1376.32"), null);
  assert.equal(localToUsd("-100", "1376.32"), null);
  assert.equal(localToUsd("100", "0"), null);
  assert.equal(localToUsd("100", "stale"), null);
  assert.equal(isValidExchangeRate(null), false);
  assert.equal(isValidExchangeRate("0"), false);
  assert.equal(isValidExchangeRate("1376.32"), true);
  assert.equal(localToUsd("999999999999999999999999", "1376.32"), "726575215066263659614.05");
});

test("send input rejects invalid signs and notation while allowing grouped typing", () => {
  assert.deepEqual(parseAmountInput("-100"), { value: "-100", valid: false });
  assert.deepEqual(parseAmountInput("1e3"), { value: "1e3", valid: false });
  assert.deepEqual(parseAmountInput("1,20"), { value: "1,20", valid: false });
  assert.deepEqual(parseAmountInput("1,200.50"), { value: "1200.50", valid: true });
  assert.deepEqual(parseAmountInput("1."), { value: "1.", valid: true });
  assert.deepEqual(parseAmountInput(""), { value: "", valid: true });
  assert.equal(quoteAmountForInput("-100", "USD", null), null);
  assert.equal(quoteAmountForInput("1e3", "USD", null), null);
});

test("decimal balance comparisons remain exact at the safe-integer boundary", () => {
  assert.equal(compareDecimal("9007199254740993", "9007199254740992"), 1);
  assert.equal(compareDecimal("9007199254740993.01", "9007199254740993.1"), -1);
  assert.equal(compareDecimal("100.00", "100"), 0);
});

test("pre-quote local estimates use exact floor arithmetic", () => {
  assert.equal(usdToLocalFloor("50", "1376.32", "NGN"), "68816");
  assert.equal(usdToLocalFloor("0.1", "2.999", "NGN"), "0");
  assert.equal(subtractDecimal("1383.2", "1376.32"), "6.88");
  assert.equal(usdToLocalFloor("50", subtractDecimal("1383.2", "1376.32"), "NGN"), "344");
});

test("the quote amount helper constructs the acceptance payload amount", () => {
  assert.equal(quoteAmountForInput("100000", "NGN", "1376.32"), "72.66");
  assert.equal(quoteAmountForInput("72.66", "USD", "1376.32"), "72.66");
  assert.equal(quoteAmountForInput("100000", "NGN", null), null);
});
