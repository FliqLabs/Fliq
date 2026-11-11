import type { Asset, FiatCurrency } from "./types";

export const ASSET_DECIMALS: Record<Asset, number> = { USDC: 6, USDT: 6 };

// ISO 4217 minor units. IDR is 2 in ISO 4217 even though rupiah is usually quoted whole.
export const FIAT_DECIMALS: Record<FiatCurrency, number> = { NGN: 2, KES: 2, GHS: 2, IDR: 2, PHP: 2 };

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

export class InvalidAmountError extends Error {
  constructor(reason: string) {
    super(`invalid amount: ${reason}`);
    this.name = "InvalidAmountError";
  }
}

export type Rounding = "exact" | "down" | "up";

export function toUnits(value: string | number, decimals: number, rounding: Rounding = "exact"): bigint {
  const text = typeof value === "number" ? numberToPlainString(value) : value.trim();
  const match = DECIMAL.exec(text);
  if (!match) throw new InvalidAmountError("not a non-negative decimal");
  const whole = match[1] ?? "0";
  let fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    const dropped = fraction.slice(decimals);
    if (rounding === "exact" && /[1-9]/.test(dropped)) {
      throw new InvalidAmountError(`more than ${decimals} decimal places`);
    }
    fraction = fraction.slice(0, decimals);
    if (rounding === "up" && /[1-9]/.test(dropped)) return BigInt(whole + fraction) + 1n;
  }
  return BigInt(whole + fraction.padEnd(decimals, "0"));
}

export function fromUnits(units: bigint, decimals: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals);
  const text = decimals === 0 ? whole : `${whole}.${fraction}`;
  return negative ? `-${text}` : text;
}

export function toDecimalString(units: bigint, decimals: number): string {
  const text = fromUnits(units, decimals);
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

export function convertAtRate(units: bigint, fromDecimals: number, rate: string, toDecimals: number): bigint {
  const { scaled, scale } = parseRate(rate);
  const numerator = units * scaled * 10n ** BigInt(toDecimals);
  return numerator / 10n ** BigInt(fromDecimals + scale);
}

// Smallest source amount whose conversion reaches the target, so a "receive exactly" quote never falls short.
export function unitsForTarget(
  targetUnits: bigint,
  fromDecimals: number,
  rate: string,
  toDecimals: number,
): bigint {
  const { scaled, scale } = parseRate(rate);
  if (scaled === 0n) throw new InvalidAmountError("rate is zero");
  const numerator = targetUnits * 10n ** BigInt(fromDecimals + scale);
  const denominator = scaled * 10n ** BigInt(toDecimals);
  return (numerator + denominator - 1n) / denominator;
}

function parseRate(rate: string): { scaled: bigint; scale: number } {
  const match = DECIMAL.exec(rate.trim());
  if (!match) throw new InvalidAmountError("rate is not a non-negative decimal");
  const fraction = match[2] ?? "";
  return { scaled: BigInt((match[1] ?? "0") + fraction), scale: fraction.length };
}

// Providers that send JSON numbers lose nothing here as long as the number already has few decimals;
// toFixed avoids exponent notation such as 1e-7.
function numberToPlainString(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new InvalidAmountError("not a finite non-negative number");
  const text = value.toString();
  return text.includes("e") ? value.toFixed(20).replace(/\.?0+$/, "") : text;
}
