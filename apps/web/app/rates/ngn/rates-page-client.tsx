"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader } from "../../components/site-header";
import { SiteFooter } from "../../components/site-footer";
import { siteContainer } from "../../components/site-container";
import { fliqApi, ApiError } from "../../lib/fliq-api";

/* -------------------------------------------------------
   TYPES
   Replace these mock data types with API response types
   when the corresponding backend endpoints are available.
------------------------------------------------------- */

type ReferenceRate = {
  source: string;
  rate: number;
};

type Rate = {
  token: string;
  currency: string;
  rate: number;
  rate_before_fees: number;
  provider: string;
  providers_quoting: number;
  spread: number;
  official: ReferenceRate;
  p2p: ReferenceRate;
  change_24h: number;
  fetched_at: string;
};

type Provider = {
  name: string;
  description: string;
  quoteRate: number | null;
  fee: string;
  effectiveRate: number | null;
  status: string;
  updated: string;
  note?: string;
};

type Snapshot = {
  time: string;
  best: number;
  worst: number;
  p2p: number;
};

type Corridor = {
  pair: string;
  rate: string;
  provider: string;
};

/* -------------------------------------------------------
   MOCK DATA
   These values come from the Figma design reference.
   They are NOT live provider quotes or historical data.
------------------------------------------------------- */

const DESIGN_PREVIEW = {
  mainRate: 1376.32,
  officialRate: 1348.01,
  p2pRate: 1381.85,
  providerRate: 1383.2,
  change24h: 0.42,
  providersQuoting: 3,
  spread: 1.3,
  fetchedAt: "14:02:13 WAT",
  conversion: {
    amount: 50,
    providerRate: 1383.2,
    gross: 69160,
    providerFee: 250,
    networkFee: 94,
    received: 68816,
  },
};

const MOCK_PROVIDERS: Provider[] = [
  {
    name: "Paycrest",
    description: "NGN bank and mobile · non-custodial",
    quoteRate: 1383.2,
    fee: "₦344 (0.50%)",
    effectiveRate: 1376.32,
    status: "Live",
    updated: "6s ago",
    note: "ROUTED",
  },
  {
    name: "Busha",
    description: "NGN bank · flat fee",
    quoteRate: 1372.23,
    fee: "₦107.50 (flat)",
    effectiveRate: 1370.08,
    status: "Live",
    updated: "9s ago",
    note: "1.3% behind",
  },
  {
    name: "Fonbnk",
    description: "Excluded from best-of until fresh",
    quoteRate: 1365,
    fee: "₦330 (0.48%)",
    effectiveRate: 1358.4,
    status: "Stale",
    updated: "13:58",
    note: "Stale 4m",
  },
  {
    name: "Bitnob",
    description: "Pre-funded float · sandbox only",
    quoteRate: null,
    fee: "—",
    effectiveRate: null,
    status: "Paused",
    updated: "27 Oct",
    note: "Sandbox only",
  },
];

const MOCK_SNAPSHOTS: Snapshot[] = [
  { time: "17:00", best: 1369.4, worst: 1372.2, p2p: 1381.85 },
  { time: "20:00", best: 1370.1, worst: 1373.1, p2p: 1381.85 },
  { time: "23:00", best: 1371.2, worst: 1374.3, p2p: 1381.85 },
  { time: "02:00", best: 1370.8, worst: 1374.5, p2p: 1381.85 },
  { time: "05:00", best: 1373.1, worst: 1375.2, p2p: 1381.85 },
  { time: "07:00", best: 1378.2, worst: 1380.1, p2p: 1381.85 },
  { time: "10:00", best: 1375.4, worst: 1378.1, p2p: 1381.85 },
  { time: "13:00", best: 1376.32, worst: 1379.4, p2p: 1381.85 },
  { time: "14:00", best: 1376.32, worst: 1378.8, p2p: 1381.85 },
];

const MOCK_CORRIDORS: Corridor[] = [
  {
    pair: "USDC to KES M-Pesa",
    rate: "KSh 129.40",
    provider: "Busha · best of 2",
  },
  {
    pair: "USDT to NGN bank",
    rate: "₦1,374.90",
    provider: "Paycrest · best of 3",
  },
  {
    pair: "USDC to NGN OPay",
    rate: "₦1,375.10",
    provider: "Paycrest · best of 2",
  },
];

const API_EXAMPLE = {
  rate: 1376.32,
  rate_before_fees: 1383.2,
  provider: "paycrest",
  providers_quoting: 3,
  change_24h: 0.0042,
  fetched_at: "2026-10-29T13:02:13Z",
};

/* -------------------------------------------------------
   FORMATTERS
------------------------------------------------------- */

const naira = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatNaira(value: number) {
  return naira.format(value);
}

function formatTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Time unavailable";

  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Africa/Lagos",
  }).format(date);
}

function providerName(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function relativeDifference(rate: number, reference: number) {
  if (!reference) return null;
  return ((rate - reference) / reference) * 100;
}

function differenceLabel(value: number | null) {
  if (value === null) return "Unavailable";

  const direction =
    value > 0 ? "above" : value < 0 ? "below" : "level with";

  return `${Math.abs(value).toFixed(2)}% ${direction}`;
}

/* -------------------------------------------------------
   REUSABLE UI
------------------------------------------------------- */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#999]">
      {children}
    </p>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-5">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-2 text-lg font-semibold tracking-tight text-white sm:text-xl">
        {title}
      </h2>
      {description && (
        <p className="mt-2 text-sm text-[#858585]">{description}</p>
      )}
    </div>
  );
}

function PreviewLabel() {
  return (
    <span className="inline-flex rounded-full border border-[#5b4d31] bg-[#332a1b] px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-[#e7c98a]">
      Design preview
    </span>
  );
}

function Panel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-[#303030] bg-[#141414] ${className}`}
    >
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div>
      <p className="text-xs text-[#858585]">{label}</p>
      <p className="mt-2 text-lg font-semibold tabular-nums text-white">
        {value}
      </p>
      {detail && <p className="mt-1 text-xs text-[#777]">{detail}</p>}
    </div>
  );
}

/* -------------------------------------------------------
   CHART
   Replace MOCK_SNAPSHOTS with a historical-rate endpoint.
   Suggested future endpoint:
   GET /rates/usdc/ngn/history?period=24h
------------------------------------------------------- */

function RateChart({
  snapshots,
}: {
  snapshots: Snapshot[];
}) {
  const [period, setPeriod] = useState("24H");

  const width = 760;
  const height = 250;
  const left = 48;
  const right = 20;
  const top = 16;
  const bottom = 32;

  const min = 1350;
  const max = 1390;

  const x = (index: number) =>
    left +
    (index / Math.max(snapshots.length - 1, 1)) * (width - left - right);

  const y = (value: number) =>
    top + ((max - value) / (max - min)) * (height - top - bottom);

  const bestLine = snapshots
    .map((point, index) => `${x(index)},${y(point.best)}`)
    .join(" ");

  const worstLine = snapshots
    .map((point, index) => `${x(index)},${y(point.worst)}`)
    .join(" ");

  const p2pLine = snapshots
    .map((point, index) => `${x(index)},${y(point.p2p)}`)
    .join(" ");

  const bandPoints = [
    ...snapshots.map((point, index) => `${x(index)},${y(point.worst)}`),
    ...snapshots
      .map(
        (point, index) =>
          `${x(snapshots.length - 1 - index)},${y(snapshots[snapshots.length - 1 - index].best)}`,
      ),
  ].join(" ");

  return (
    <Panel className="p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Eyebrow>Rate history</Eyebrow>
          <h3 className="mt-2 text-sm font-semibold text-white">
            Best after-fee rate over time
          </h3>
        </div>

        <div className="flex rounded-lg border border-[#303030] p-1">
          {["24H", "7D", "30D"].map((item) => (
            <button
              key={item}
              onClick={() => setPeriod(item)}
              className={`rounded-md px-3 py-1.5 text-[10px] font-semibold transition ${
                period === item
                  ? "bg-[#a594ff] text-[#111]"
                  : "text-[#888] hover:text-white"
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-3 text-[10px] text-[#999]">
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#a594ff]" />
          Best after fees
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#777]" />
          Live providers · worst to best
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#d5b36b]" />
          P2P
        </span>
        <span className="text-[#666]">Official off</span>
      </div>

      <div className="mt-5 overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full"
          role="img"
          aria-label="Illustrative rate history chart"
        >
          {[1350, 1360, 1370, 1380, 1390].map((value) => (
            <g key={value}>
              <line
                x1={left}
                x2={width - right}
                y1={y(value)}
                y2={y(value)}
                stroke="#303030"
                strokeDasharray="3 5"
              />
              <text
                x="0"
                y={y(value) + 4}
                fill="#777"
                fontSize="11"
              >
                {value}
              </text>
            </g>
          ))}

          <polygon points={bandPoints} fill="#a594ff" opacity="0.10" />

          <polyline
            points={p2pLine}
            fill="none"
            stroke="#d5b36b"
            strokeWidth="1.5"
            strokeDasharray="5 5"
          />

          <polyline
            points={worstLine}
            fill="none"
            stroke="#777"
            strokeWidth="1.5"
          />

          <polyline
            points={bestLine}
            fill="none"
            stroke="#a594ff"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {snapshots.map((point, index) => (
            <circle
              key={point.time}
              cx={x(index)}
              cy={y(point.best)}
              r="3"
              fill="#a594ff"
            />
          ))}

          {snapshots.map((point, index) => (
            <text
              key={point.time}
              x={x(index)}
              y={height - 8}
              textAnchor="middle"
              fill="#777"
              fontSize="10"
            >
              {point.time}
            </text>
          ))}
        </svg>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-[#303030] pt-4">
        <Metric label="24h low" value="₦1,369.40" detail="At 17:00" />
        <Metric label="24h high" value="₦1,378.20" detail="At 07:00" />
        <Metric label="Provider band" value="1.3%" detail="Worst to best" />
      </div>

      <p className="mt-4 text-[10px] text-[#666]">
        {period} preview data only. Historical snapshots are not yet connected
        to the API. Stale and paused providers are excluded.
      </p>
    </Panel>
  );
}

/* -------------------------------------------------------
   PROVIDER COMPARISON
   Replace MOCK_PROVIDERS with a provider quotes endpoint.
------------------------------------------------------- */

function ProviderTable({
  providers,
}: {
  providers: Provider[];
}) {
  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5 sm:p-6">
        <div>
          <Eyebrow>Market comparison</Eyebrow>
          <h3 className="mt-2 text-base font-semibold text-white">
            Who&apos;s quoting right now
          </h3>
        </div>
        <PreviewLabel />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left">
          <thead>
            <tr className="border-y border-[#303030] text-[9px] font-semibold uppercase tracking-wider text-[#777]">
              <th className="px-5 py-4">Provider</th>
              <th className="px-4 py-4">Quote rate</th>
              <th className="px-4 py-4">Fee on $50</th>
              <th className="px-4 py-4">Effective</th>
              <th className="px-4 py-4">Status</th>
              <th className="px-4 py-4">Updated</th>
            </tr>
          </thead>

          <tbody>
            {providers.map((provider) => (
              <tr
                key={provider.name}
                className="border-b border-[#292929] last:border-0"
              >
                <td className="px-5 py-5">
                  <p className="text-sm font-semibold text-white">
                    {provider.name}
                  </p>
                  <p className="mt-1 text-[10px] text-[#777]">
                    {provider.description}
                  </p>
                  {provider.note && (
                    <p className="mt-1 text-[9px] font-semibold text-[#a594ff]">
                      {provider.note}
                    </p>
                  )}
                </td>

                <td className="px-4 py-5 text-xs tabular-nums text-[#ccc]">
                  {provider.quoteRate === null
                    ? "—"
                    : formatNaira(provider.quoteRate)}
                </td>

                <td className="px-4 py-5 text-xs text-[#ccc]">
                  {provider.fee}
                </td>

                <td className="px-4 py-5 text-xs font-semibold tabular-nums text-white">
                  {provider.effectiveRate === null
                    ? "—"
                    : formatNaira(provider.effectiveRate)}
                </td>

                <td className="px-4 py-5">
                  <span
                    className={`rounded-full px-2 py-1 text-[9px] ${
                      provider.status === "Live"
                        ? "bg-[#183629] text-[#70d6a3]"
                        : provider.status === "Stale"
                          ? "bg-[#382f1e] text-[#e4c17d]"
                          : "bg-[#303030] text-[#999]"
                    }`}
                  >
                    {provider.status}
                  </span>
                </td>

                <td className="px-4 py-5 text-xs text-[#888]">
                  {provider.updated}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="p-5 text-[10px] text-[#666]">
        Provider rows are Figma reference values for layout integration.
        They are not verified live quotes.
      </p>
    </Panel>
  );
}

/* -------------------------------------------------------
   CONVERSION BREAKDOWN
   Connect to a quote endpoint when the quote flow is ready.
------------------------------------------------------- */

function ConversionPanel() {
  const conversion = DESIGN_PREVIEW.conversion;

  return (
    <Panel className="p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Eyebrow>Example conversion</Eyebrow>
          <h3 className="mt-2 text-lg font-semibold text-white">
            What $50 becomes
          </h3>
        </div>
        <PreviewLabel />
      </div>

      <p className="mt-7 text-3xl font-semibold tracking-tight text-white">
        {formatNaira(conversion.received)}
      </p>
      <p className="mt-2 text-xs text-[#888]">Estimated amount landing in bank</p>

      <div className="mt-7 space-y-4 border-t border-[#303030] pt-5">
        <div className="flex justify-between gap-4 text-sm">
          <span className="text-[#888]">
            ${conversion.amount} at provider rate
          </span>
          <span className="tabular-nums text-white">
            {formatNaira(conversion.gross)}
          </span>
        </div>

        <div className="flex justify-between gap-4 text-sm">
          <span className="text-[#888]">Paycrest fee</span>
          <span className="tabular-nums text-white">
            −{formatNaira(conversion.providerFee)}
          </span>
        </div>

        <div className="flex justify-between gap-4 text-sm">
          <span className="text-[#888]">Network fee · Solana</span>
          <span className="tabular-nums text-white">
            −{formatNaira(conversion.networkFee)}
          </span>
        </div>

        <div className="flex justify-between gap-4 border-t border-[#303030] pt-4 text-sm">
          <span className="font-medium text-white">Lands in bank</span>
          <span className="font-semibold tabular-nums text-[#a594ff]">
            {formatNaira(conversion.received)}
          </span>
        </div>
      </div>

      <p className="mt-5 text-xs leading-6 text-[#888]">
        Equivalent to ₦1,376.32 per $1 after fees. Fliq&apos;s share is included
        in the displayed fee breakdown.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/docs"
          className="rounded-lg bg-[#a594ff] px-4 py-3 text-xs font-semibold text-[#111] transition hover:bg-[#b5a8ff]"
        >
          Get this rate via API
        </Link>

        <button
          onClick={() =>
            navigator.clipboard?.writeText("https://fliq.money/rates/ngn")
          }
          className="rounded-lg border border-[#383838] px-4 py-3 text-xs text-white hover:bg-white/5"
        >
          Copy link
        </button>

        <a
          href="https://twitter.com/intent/tweet?text=Compare%20USDC%20to%20NGN%20rates%20on%20Fliq"
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-[#383838] px-4 py-3 text-xs text-white hover:bg-white/5"
        >
          Share on X
        </a>
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------
   MAIN PAGE
------------------------------------------------------- */

export function RatesPageClient() {
  const {
    data: rate,
    isPending,
    isError,
    error,
    dataUpdatedAt,
    refetch,
  } = useQuery({
    queryKey: ["public-rate", "usdc", "ngn"],
    queryFn: () => fliqApi<Rate>("rates/usdc/ngn"),
    staleTime: 10_000,
    refetchInterval: 10_000,
    retry: 1,
  });

  const liveRate = rate?.rate ?? DESIGN_PREVIEW.mainRate;
  const officialRate = rate?.official?.rate ?? DESIGN_PREVIEW.officialRate;
  const p2pRate = rate?.p2p?.rate ?? DESIGN_PREVIEW.p2pRate;

  const officialDifference = relativeDifference(liveRate, officialRate);
  const p2pDifference = relativeDifference(liveRate, p2pRate);

  const isPreview = !rate;

  return (
    <div className="min-h-screen bg-[#0b0b0b] text-white">
      <SiteHeader activeHref="/rates/ngn" />

      <main className={`${siteContainer} pb-20 pt-28`}>
        {/* Breadcrumb */}
        <div className="mb-9 flex flex-wrap items-center gap-2 text-[11px] text-[#777]">
          <Link href="/dashboard" className="hover:text-white">
            Dashboard
          </Link>
          <span>/</span>
          <Link href="/rates/ngn" className="hover:text-white">
            Rates
          </Link>
          <span>/</span>
          <span className="text-[#ccc]">USDC to NGN bank</span>
        </div>

        {/* Heading */}
        <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
          <div>
            <Eyebrow>Fliq rates / Nigeria</Eyebrow>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[42px]">
              USDC to NGN bank
            </h1>
            <p className="mt-3 text-sm text-[#999]">
              You receive, after fees. Compare the best available payout route.
            </p>
          </div>

          <div className="text-xs text-[#777]">
            <p>fliq.money/rates/ngn</p>
            <p className="mt-1">NGN · Nigerian naira</p>
          </div>
        </div>

        {/* Main rate */}
        <Panel className="mb-5 p-6 sm:p-9">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <Eyebrow>Best rate after fees · 1 USDC</Eyebrow>
                {isPreview && <PreviewLabel />}
              </div>

              <h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">
                {formatNaira(liveRate)}
              </h2>

              <p className="mt-3 text-sm text-[#999]">
                {rate
                  ? `via ${providerName(rate.provider)}`
                  : "Figma reference rate · live value unavailable"}
              </p>
            </div>

            <div className="min-w-[125px] rounded-xl border border-[#303030] p-4">
              <Eyebrow>24h change</Eyebrow>
              <p className="mt-2 text-xl font-semibold text-[#70d6a3]">
                {rate
                  ? `${rate.change_24h >= 0 ? "+" : ""}${(rate.change_24h * 100).toFixed(2)}%`
                  : `+${DESIGN_PREVIEW.change24h.toFixed(2)}%`}
              </p>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-6 border-t border-[#303030] pt-6 sm:grid-cols-4">
            <Metric
              label="Official CBN NFEM close"
              value={formatNaira(officialRate)}
              detail={
                isPreview ? "Design reference" : rate?.official.source
              }
            />

            <Metric
              label="P2P Bybit USDT/NGN median"
              value={formatNaira(p2pRate)}
              detail={isPreview ? "Design reference" : rate?.p2p.source}
            />

            <Metric
              label="Providers quoting"
              value={String(rate?.providers_quoting ?? DESIGN_PREVIEW.providersQuoting)}
              detail="Provider count"
            />

            <Metric
              label="Last updated"
              value={
                rate
                  ? formatTime(rate.fetched_at)
                  : DESIGN_PREVIEW.fetchedAt
              }
              detail="Lagos time"
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[#303030] pt-4">
            <p className="text-[10px] text-[#777]">
              {isPreview
                ? "Live rate unavailable. Showing Figma reference values."
                : `Automatically refreshed every 10 seconds · Updated ${formatTime(new Date(dataUpdatedAt).toISOString())}`}
            </p>

            <button
              onClick={() => refetch()}
              className="text-xs text-[#a594ff] hover:text-white"
            >
              Refresh rate ↗
            </button>
          </div>

          {isError && (
            <p className="mt-3 text-xs text-[#d6a36c]">
              {error instanceof ApiError
                ? error.message
                : "The live rate endpoint is temporarily unavailable."}
            </p>
          )}
        </Panel>

        {/* Reference comparisons */}
        <div className="mb-12 grid gap-4 sm:grid-cols-2">
          <Panel className="p-5 sm:p-6">
            <Eyebrow>Official reference</Eyebrow>
            <h3 className="mt-3 text-sm font-semibold text-white">
              CBN NFEM close
            </h3>
            <p className="mt-4 text-2xl font-semibold tabular-nums">
              {formatNaira(officialRate)}
            </p>
            <p className="mt-2 text-xs text-[#888]">
              Fliq&apos;s rate is {differenceLabel(officialDifference)} this
              reference.
            </p>
          </Panel>

          <Panel className="p-5 sm:p-6">
            <Eyebrow>P2P reference</Eyebrow>
            <h3 className="mt-3 text-sm font-semibold text-white">
              Bybit USDT/NGN median
            </h3>
            <p className="mt-4 text-2xl font-semibold tabular-nums">
              {formatNaira(p2pRate)}
            </p>
            <p className="mt-2 text-xs text-[#888]">
              Fliq&apos;s rate is {differenceLabel(p2pDifference)} this
              reference.
            </p>
          </Panel>
        </div>

        {/* Chart */}
        <div className="mb-12">
          <SectionHeading
            eyebrow="Market movement"
            title="Rate history"
            description="Best after-fee rates and provider spread across the selected period."
          />
          <RateChart snapshots={MOCK_SNAPSHOTS} />
        </div>

        {/* Provider table */}
        <div className="mb-12">
          <SectionHeading
            eyebrow="Provider comparison"
            title="Compare live payout routes"
            description="Three of four providers quoting · 1.3% apart in this design reference."
          />
          <ProviderTable providers={MOCK_PROVIDERS} />
        </div>

        {/* Conversion */}
        <div className="mb-12">
          <ConversionPanel />
        </div>

        {/* API response */}
        <div className="mb-12 grid gap-5 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <Eyebrow>For developers</Eyebrow>
            <h2 className="mt-3 text-xl font-semibold">
              One endpoint. One rate.
            </h2>
            <p className="mt-3 max-w-md text-sm leading-7 text-[#888]">
              Retrieve the current USDC to NGN rate, provider and reference
              rates through the public Fliq API.
            </p>
            <p className="mt-5 inline-flex rounded-lg border border-[#303030] px-3 py-2 font-mono text-xs text-[#c5b8ff]">
              GET /v1/rates/usdc/ngn
            </p>
          </div>

          <Panel className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#303030] px-5 py-4">
              <span className="text-xs font-semibold text-white">
                Example response
              </span>
              <PreviewLabel />
            </div>
            <pre className="overflow-x-auto p-5 text-xs leading-6 text-[#b9b0d8]">
              {JSON.stringify(API_EXAMPLE, null, 2)}
            </pre>
          </Panel>
        </div>

        {/* Other corridors */}
        <div className="mb-12">
          <SectionHeading
            eyebrow="Explore other markets"
            title="Other corridors"
            description="More stablecoin-to-local-currency routes."
          />

          <div className="grid gap-3 md:grid-cols-3">
            {MOCK_CORRIDORS.map((corridor) => (
              <Panel key={corridor.pair} className="p-5">
                <p className="text-sm font-semibold text-white">
                  {corridor.pair}
                </p>
                <p className="mt-4 text-xl font-semibold tabular-nums">
                  {corridor.rate}
                </p>
                <p className="mt-2 text-xs text-[#777]">
                  {corridor.provider}
                </p>
              </Panel>
            ))}
          </div>
        </div>

        {/* Disclaimer */}
        <div className="border-t border-[#303030] pt-6">
          <p className="max-w-3xl text-[10px] leading-6 text-[#777]">
            Rates are quotes from licensed providers, polled every 10 seconds.
            Not financial advice. Official reference published by FMDQ. P2P
            reference is a median of public ads. Chart, provider comparison,
            conversion and related corridor values are Figma design previews
            until connected to verified API data.
          </p>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
