export type LocalCurrency = "NGN" | "KES" | "GHS" | "IDR" | "PHP";
export type CurrencyCode = LocalCurrency | "USD";

type CurrencyMeta = {
  symbol: string;
  decimals: number;
  country: string;
  flag: string;
  payoutType: "bank" | "mobile_money";
};

export const CURRENCIES: Record<LocalCurrency, CurrencyMeta> = {
  NGN: { symbol: "₦", decimals: 0, country: "Nigeria", flag: "/app/flag-ngn.webp", payoutType: "bank" },
  KES: { symbol: "KSh ", decimals: 0, country: "Kenya", flag: "/app/flag-kes.webp", payoutType: "mobile_money" },
  GHS: { symbol: "GH₵", decimals: 2, country: "Ghana", flag: "/app/flag-ghs.webp", payoutType: "mobile_money" },
  IDR: { symbol: "Rp ", decimals: 0, country: "Indonesia", flag: "/app/flag-idr.webp", payoutType: "bank" },
  PHP: { symbol: "₱", decimals: 2, country: "Philippines", flag: "/app/flag-php.webp", payoutType: "bank" },
};

export const LOCAL_CURRENCIES = Object.keys(CURRENCIES) as LocalCurrency[];

const COUNTRY_CODES: Record<LocalCurrency, "ng" | "ke" | "gh" | "id" | "ph"> = {
  NGN: "ng",
  KES: "ke",
  GHS: "gh",
  IDR: "id",
  PHP: "ph",
};

export function isLocalCurrency(value: string): value is LocalCurrency {
  return value.toUpperCase() in CURRENCIES;
}

export function toCurrency(value: string): CurrencyCode {
  const upper = value.toUpperCase();
  return upper === "USD" || isLocalCurrency(upper) ? (upper as CurrencyCode) : "USD";
}

export function countryOf(currency: LocalCurrency) {
  return COUNTRY_CODES[currency];
}

export function symbolOf(currency: CurrencyCode) {
  return currency === "USD" ? "$" : CURRENCIES[currency].symbol;
}

export function decimalsOf(currency: CurrencyCode) {
  return currency === "USD" ? 2 : CURRENCIES[currency].decimals;
}

type DecimalParts = { digits: bigint; scale: bigint; fractionLength: number };

function decimalParts(value: number | string): DecimalParts | null {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return { digits: BigInt(`${whole}${fraction}`), scale: 10n ** BigInt(fraction.length), fractionLength: fraction.length };
}

function decimalString(digits: bigint, decimals: number) {
  const negative = digits < 0n;
  const absolute = negative ? -digits : digits;
  const text = absolute.toString().padStart(decimals + 1, "0");
  const whole = decimals ? text.slice(0, -decimals) : text;
  const fraction = decimals ? text.slice(-decimals) : "";
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function roundedScaled(value: number | string, decimals: number): bigint | null {
  const parts = decimalParts(value);
  if (!parts) return null;
  const target = 10n ** BigInt(decimals);
  const numerator = parts.digits * target;
  const quotient = numerator / parts.scale;
  const remainder = numerator % parts.scale;
  return quotient + (remainder * 2n >= parts.scale ? 1n : 0n);
}

function grouped(value: number | string, decimals: number) {
  const scaled = roundedScaled(value, decimals);
  if (scaled == null) return "—";
  const text = decimalString(scaled, decimals);
  const [whole, fraction] = text.split(".");
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${groupedWhole}.${fraction}` : groupedWhole;
}

/** "₦68,816", "KSh 6,450", "$50.00". Whole local units in, as the API sends `receive` and money amounts. */
export function formatMoney(value: number | string, currency: CurrencyCode) {
  return symbolOf(currency) + grouped(value, decimalsOf(currency));
}

export function formatUsd(value: number | string) {
  return formatMoney(value, "USD");
}

/** A rate always shows two decimals, even in a currency whose amounts show none: "₦1,376.32". */
export function formatRate(rate: number | string, currency: CurrencyCode) {
  return symbolOf(currency) + grouped(rate, 2);
}

export function isValidPositiveDecimal(value: number | string | null | undefined) {
  const parts = value == null ? null : decimalParts(value);
  return Boolean(parts && parts.digits > 0n);
}

export function compareDecimal(left: number | string, right: number | string) {
  const a = decimalParts(left);
  const b = decimalParts(right);
  if (!a || !b) throw new Error("Invalid decimal");
  const scale = a.fractionLength > b.fractionLength ? a.fractionLength : b.fractionLength;
  const leftScaled = a.digits * 10n ** BigInt(scale - a.fractionLength);
  const rightScaled = b.digits * 10n ** BigInt(scale - b.fractionLength);
  return leftScaled < rightScaled ? -1 : leftScaled > rightScaled ? 1 : 0;
}

export function isValidExchangeRate(rate: number | string | null | undefined) {
  return isValidPositiveDecimal(rate);
}

function divideAndRoundUp(numerator: bigint, denominator: bigint) {
  return numerator / denominator + (numerator % denominator === 0n ? 0n : 1n);
}

/** Converts a local-currency amount to USDC, always rounding up to the nearest cent. */
export function localToUsd(localAmount: number | string, rate: number | string) {
  const local = decimalParts(localAmount);
  const exchangeRate = decimalParts(rate);
  if (!local || !exchangeRate || exchangeRate.digits === 0n) return null;
  const cents = divideAndRoundUp(local.digits * 100n * exchangeRate.scale, local.scale * exchangeRate.digits);
  return decimalString(cents, 2);
}

/** Converts a USD amount to local currency using exact decimal arithmetic and display precision. */
export function usdToLocal(usdAmount: number | string, rate: number | string, currency: LocalCurrency) {
  return usdToLocalAtPrecision(usdAmount, rate, currency, "nearest");
}

export function usdToLocalFloor(usdAmount: number | string, rate: number | string, currency: LocalCurrency) {
  return usdToLocalAtPrecision(usdAmount, rate, currency, "floor");
}

function usdToLocalAtPrecision(
  usdAmount: number | string,
  rate: number | string,
  currency: LocalCurrency,
  rounding: "floor" | "nearest",
) {
  const usd = decimalParts(usdAmount);
  const exchangeRate = decimalParts(rate);
  if (!usd || !exchangeRate || exchangeRate.digits === 0n) return null;
  const decimals = decimalsOf(currency);
  const target = 10n ** BigInt(decimals);
  const numerator = usd.digits * exchangeRate.digits * target;
  const denominator = usd.scale * exchangeRate.scale;
  const rounded = rounding === "floor" ? numerator / denominator : (numerator + denominator / 2n) / denominator;
  return decimalString(rounded, decimals);
}

export function subtractDecimal(left: number | string, right: number | string) {
  const a = decimalParts(left);
  const b = decimalParts(right);
  if (!a || !b) return null;
  const scale = a.fractionLength > b.fractionLength ? a.fractionLength : b.fractionLength;
  const leftScaled = a.digits * 10n ** BigInt(scale - a.fractionLength);
  const rightScaled = b.digits * 10n ** BigInt(scale - b.fractionLength);
  if (leftScaled < rightScaled) return null;
  return decimalString(leftScaled - rightScaled, scale);
}

export type ParsedAmount = { value: string; valid: boolean };

/** Validates the send input without turning malformed or negative text into another amount. */
export function parseAmountInput(typed: string): ParsedAmount {
  const text = typed.trim();
  if (!text) return { value: "", valid: true };
  if (!/^(?:(?:\d{1,3}(?:,\d{3})+)|\d+)?(?:\.\d{0,2})?$/.test(text)) return { value: text, valid: false };
  const normalized = text.replace(/,/g, "");
  const [whole, fraction] = normalized.split(".");
  const trimmedWhole = (whole || "").replace(/^0+(?=\d)/, "");
  return { value: `${trimmedWhole || "0"}${fraction != null ? `.${fraction}` : ""}`, valid: true };
}

export function quoteAmountForInput(amount: string, currency: CurrencyCode, rate: number | string | null | undefined) {
  if (!isValidPositiveDecimal(amount)) return null;
  return currency === "USD" ? amount : rate != null && isValidExchangeRate(rate) ? localToUsd(amount, rate) : null;
}

/** Quote and payout fees come in minor units: kobo, cents. */
export function fromMinorUnits(minor: number) {
  return minor / 100;
}

/** Keeps what a person types into an amount field to digits and one dot with at most two decimals. */
export function cleanAmount(typed: string) {
  const digits = typed.replace(/[^\d.]/g, "");
  const [whole, ...rest] = digits.split(".");
  const trimmedWhole = whole.replace(/^0+(?=\d)/, "");
  if (rest.length === 0) return trimmedWhole;
  return `${trimmedWhole || "0"}.${rest.join("").slice(0, 2)}`;
}

/** USDC has six decimals on NEAR. Decimal string in, base units out, never through a float. */
export function toTokenUnits(amount: string, decimals = 6): bigint {
  const [whole, fraction = ""] = amount.trim().split(".");
  if (!/^\d+$/.test(whole || "0") || !/^\d*$/.test(fraction) || fraction.length > decimals) {
    throw new Error(`Not a token amount: ${amount}`);
  }
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}
