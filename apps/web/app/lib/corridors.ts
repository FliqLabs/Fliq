/* Every corridor the rates pages know about, in display order. A corridor that is not live is listed as
   coming soon, and turns live on its own once GET /rates/usdc/{code} answers. */

export type Corridor = {
  code: string;
  currency: string;
  currencyName: string;
  country: string;
  flag: string;
  locale: string;
  timeZone: string;
  cityTime: string;
  /** How money lands, as the heading says it: "USDC to NGN bank". */
  method: string;
  officialReference: string;
  p2pReference: string;
  live: boolean;
};

export const CORRIDORS: Corridor[] = [
  {
    code: "ngn",
    currency: "NGN",
    currencyName: "Nigerian naira",
    country: "Nigeria",
    flag: "🇳🇬",
    locale: "en-NG",
    timeZone: "Africa/Lagos",
    cityTime: "Lagos time",
    method: "bank",
    officialReference: "CBN NFEM close",
    p2pReference: "Bybit USDT/NGN median",
    live: true,
  },
  {
    code: "kes",
    currency: "KES",
    currencyName: "Kenyan shilling",
    country: "Kenya",
    flag: "🇰🇪",
    locale: "en-KE",
    timeZone: "Africa/Nairobi",
    cityTime: "Nairobi time",
    method: "M-Pesa",
    officialReference: "Central Bank of Kenya reference",
    p2pReference: "Bybit USDT/KES median",
    live: true,
  },
  {
    code: "ghs",
    currency: "GHS",
    currencyName: "Ghanaian cedi",
    country: "Ghana",
    flag: "🇬🇭",
    locale: "en-GH",
    timeZone: "Africa/Accra",
    cityTime: "Accra time",
    method: "mobile money",
    officialReference: "Bank of Ghana reference",
    p2pReference: "Bybit USDT/GHS median",
    live: false,
  },
  {
    code: "ugx",
    currency: "UGX",
    currencyName: "Ugandan shilling",
    country: "Uganda",
    flag: "🇺🇬",
    locale: "en-UG",
    timeZone: "Africa/Kampala",
    cityTime: "Kampala time",
    method: "mobile money",
    officialReference: "Bank of Uganda reference",
    p2pReference: "Bybit USDT/UGX median",
    live: false,
  },
  {
    code: "tzs",
    currency: "TZS",
    currencyName: "Tanzanian shilling",
    country: "Tanzania",
    flag: "🇹🇿",
    locale: "en-TZ",
    timeZone: "Africa/Dar_es_Salaam",
    cityTime: "Dar es Salaam time",
    method: "mobile money",
    officialReference: "Bank of Tanzania reference",
    p2pReference: "Bybit USDT/TZS median",
    live: false,
  },
  {
    code: "zar",
    currency: "ZAR",
    currencyName: "South African rand",
    country: "South Africa",
    flag: "🇿🇦",
    locale: "en-ZA",
    timeZone: "Africa/Johannesburg",
    cityTime: "Johannesburg time",
    method: "bank",
    officialReference: "South African Reserve Bank reference",
    p2pReference: "Bybit USDT/ZAR median",
    live: false,
  },
];

export function corridorFor(code: string): Corridor | undefined {
  return CORRIDORS.find((corridor) => corridor.code === code.toLowerCase());
}

/* Rate requests give up after this long, so a corridor that hangs shows as unavailable instead of loading forever. */
export const RATE_TIMEOUT_MS = 8_000;

export function withTimeout(): RequestInit {
  return { signal: AbortSignal.timeout(RATE_TIMEOUT_MS) };
}

export function moneyFormatter(corridor: Corridor) {
  return new Intl.NumberFormat(corridor.locale, {
    style: "currency",
    currency: corridor.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function pairTitle(corridor: Corridor) {
  return `USDC to ${corridor.currency} ${corridor.method}`;
}
