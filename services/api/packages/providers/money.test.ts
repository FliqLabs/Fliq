import { describe, expect, it } from "vitest";
import { InvalidAmountError, convertAtRate, fromUnits, toUnits, unitsForTarget } from "./money";

describe("money", () => {
  it("parses decimal strings and numbers into base units", () => {
    expect(toUnits("50.00", 6)).toBe(50_000_000n);
    expect(toUnits("0.5", 6)).toBe(500_000n);
    expect(toUnits(1376.32, 2)).toBe(137_632n);
    expect(toUnits("68816", 2)).toBe(6_881_600n);
  });

  it("refuses to drop precision unless asked to round down", () => {
    expect(() => toUnits("1.2345678", 6)).toThrow(InvalidAmountError);
    expect(toUnits("1.2345678", 6, "down")).toBe(1_234_567n);
    expect(toUnits("1.2300000", 6)).toBe(1_230_000n);
  });

  it("rejects negatives, exponents and junk", () => {
    for (const bad of ["-1", "1e3", "abc", "", "1.2.3"])
      expect(() => toUnits(bad, 6)).toThrow(InvalidAmountError);
    expect(() => toUnits(-1, 6)).toThrow(InvalidAmountError);
  });

  it("formats base units back to decimals", () => {
    expect(fromUnits(50_000_000n, 6)).toBe("50.000000");
    expect(fromUnits(5n, 2)).toBe("0.05");
    expect(fromUnits(7n, 0)).toBe("7");
  });

  it("converts at a decimal rate without floating point", () => {
    expect(convertAtRate(50_000_000n, 6, "1376.32", 2)).toBe(6_881_600n);
    expect(convertAtRate(1n, 6, "1376.32", 2)).toBe(0n);
  });

  it("finds the smallest send amount reaching a receive target", () => {
    const units = unitsForTarget(6_881_600n, 6, "1376.32", 2);
    expect(units).toBe(50_000_000n);
    const odd = unitsForTarget(100n, 6, "1376.32", 2);
    expect(convertAtRate(odd, 6, "1376.32", 2) >= 100n).toBe(true);
    expect(convertAtRate(odd - 1n, 6, "1376.32", 2) < 100n).toBe(true);
  });
});
