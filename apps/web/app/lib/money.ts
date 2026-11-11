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

function grouped(value: number, decimals: number) {
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** "₦68,816", "KSh 6,450", "$50.00". Whole local units in, as the API sends `receive` and money amounts. */
export function formatMoney(value: number | string, currency: CurrencyCode) {
  return symbolOf(currency) + grouped(Number(value), decimalsOf(currency));
}

export function formatUsd(value: number | string) {
  return formatMoney(value, "USD");
}

/** A rate always shows two decimals, even in a currency whose amounts show none: "₦1,376.32". */
export function formatRate(rate: number, currency: CurrencyCode) {
  return symbolOf(currency) + grouped(rate, 2);
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
