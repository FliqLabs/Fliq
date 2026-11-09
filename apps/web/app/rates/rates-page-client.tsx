"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader } from "../components/site-header";
import { SiteFooter } from "../components/site-footer";
import { siteContainer } from "../components/site-container";
import { fliqApi, ApiError } from "../lib/fliq-api";
import { type Corridor, moneyFormatter, pairTitle, withTimeout } from "../lib/corridors";
import { CorridorCards, CurrencySwitcher } from "./corridor-picker";

/* -------------------------------------------------------
   TYPES
   ReferenceRate and Rate mirror components["schemas"] in
   spec/ts/openapi.ts (GET /rates/{token}/{currency}).
   Keep them in step with the spec.
------------------------------------------------------- */

type ProviderId = "paycrest" | "busha" | "fonbnk" | "bitnob" | "transfi" | "mock";

type ReferenceRate = {
  source: string;
  rate: number;
};

type Rate = {
  token: string;
  currency: string;
  /** Local currency per 1 token, after fees */
  rate: number;
  rate_before_fees: number;
  provider: ProviderId;
  providers_quoting: number;
  spread: number;
  official?: ReferenceRate;
  p2p?: ReferenceRate;
  change_24h?: number;
  fetched_at: string;
};

type ProviderRate = {
  provider: string;  
  status: "live" | "stale" | "paused";
  rate: number | null;
  rate_before_fees: number | null;
  fee: number | null;
  fee_percent: number | null;
  receive: number | null;
  eta_seconds: number | null;
  on_time_percent: number | null;
  updated_at: string;
  not_offered_reason: string | null;
};

type RateBoard = {
  token: string;
  currency: string;
  amount: string;
  best: string | null;
  fetched_at: string;
  providers: ProviderRate[];
};

type HistoryRange = "24h" | "7d" | "30d";
type HistoryPoint = {
  timestamp?: string;
  time?: string;
  at?: string;
  rate?: number;
  best_rate?: number;
  best?: number;
};
type RateHistory = {
  token: string;
  currency: string;
  range: HistoryRange;
  interval_seconds: number;
  points: HistoryPoint[];
};

/* Text for values the live rate has not filled in yet. */
const EMPTY = "-";

/* -------------------------------------------------------
   FORMATTERS
------------------------------------------------------- */

function formatTime(value: string, corridor: Corridor) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Time unavailable";

  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: corridor.timeZone,
  }).format(date);
}

function providerName(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatMoneyOrEmpty(format: (value: number) => string, value: number | undefined) {
  return value === undefined ? EMPTY : format(value);
}

/* A corridor the API does not pay yet answers 400, 404 or 422: that reads as "coming soon", not as a broken
   page. A timeout or a server error on a live corridor is a temporary outage. */
function isCorridorNotOffered(error: unknown) {
  return error instanceof ApiError && [400, 404, 422].includes(error.status);
}

function isRetryable(error: unknown) {
  return !(error instanceof ApiError) || error.status >= 500;
}

function relativeDifference(rate: number, reference: number) {
  if (!reference) return null;
  return ((rate - reference) / reference) * 100;
}

function differenceLabel(value: number | null) {
  if (value === null) return "Unavailable";

  const direction = value > 0 ? "above" : value < 0 ? "below" : "level with";

  return `${Math.abs(value).toFixed(2)}% ${direction}`;
}

/* -------------------------------------------------------
   REUSABLE UI
------------------------------------------------------- */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#999]">{children}</p>;
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
      <h2 className="mt-2 text-lg font-semibold tracking-tight text-white sm:text-xl">{title}</h2>
      {description && <p className="mt-2 text-sm text-[#858585]">{description}</p>}
    </div>
  );
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-[#303030] bg-[#141414] ${className}`}>{children}</section>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div>
      <p className="text-xs text-[#858585]">{label}</p>
      <p className="mt-2 text-lg font-semibold tabular-nums text-white">{value}</p>
      {detail && <p className="mt-1 text-xs text-[#777]">{detail}</p>}
    </div>
  );
}

/* -------------------------------------------------------
   RATE HISTORY
------------------------------------------------------- */

function historyLabel(value: string, range: HistoryRange, corridor: Corridor) {
  return new Intl.DateTimeFormat(corridor.locale, {
    timeZone: corridor.timeZone,
    ...(range === "24h" ? { hour: "2-digit", minute: "2-digit" } : { month: "short", day: "numeric" }),
  }).format(new Date(value));
}

function RateChart({ corridor, format }: { corridor: Corridor; format: (value: number) => string }) {
  const [range, setRange] = useState<HistoryRange>("24h");
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["rate-history", "usdc", corridor.code, range],
    queryFn: () => fliqApi<RateHistory>(`rates/usdc/${corridor.code}/history?range=${range}`, withTimeout()),
    retry: (failureCount, err) => isRetryable(err) && failureCount < 1,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const points = (data?.points ?? []).flatMap((point) => {
    const time = point.timestamp ?? point.time ?? point.at;
    const rate = point.rate ?? point.best_rate ?? point.best;
    if (typeof time !== "string" || typeof rate !== "number") return [];
    if (!Number.isFinite(rate) || Number.isNaN(Date.parse(time))) return [];
    return [{ time, rate }];
  });

  const width = 760;
  const height = 250;
  const left = 60;
  const right = 20;
  const top = 20;
  const bottom = 36;
  const rates = points.map((point) => point.rate);
  const low = Math.min(...rates);
  const high = Math.max(...rates);
  const padding = Math.max((high - low) * 0.1, 1);
  const min = low - padding;
  const max = high + padding;
  const x = (index: number) => left + (index / Math.max(points.length - 1, 1)) * (width - left - right);
  const y = (value: number) => top + ((max - value) / (max - min)) * (height - top - bottom);
  const line = points.map((point, index) => x(index) + "," + y(point.rate)).join(" ");

  return (
    <Panel className="p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Eyebrow>Rate history</Eyebrow>
          <h3 className="mt-2 text-sm font-semibold text-white">Best after-fee rate over time</h3>
        </div>
        <div className="flex rounded-lg border border-[#303030] p-1" aria-label="Rate history range">
          {(["24h", "7d", "30d"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={range === option}
              onClick={() => setRange(option)}
              className={
                "rounded-md px-3 py-1.5 text-[10px] font-semibold uppercase transition " +
                (range === option ? "bg-[#a594ff] text-[#111]" : "text-[#888] hover:text-white")
              }
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {isPending && (
        <p role="status" className="mt-8 text-sm text-[#999]">
          Loading rate history...
        </p>
      )}
      {isError && (
        <p role="alert" className="mt-8 text-sm text-[#d6a36c]">
          {error instanceof ApiError ? error.message : "Rate history unavailable right now."}
        </p>
      )}
      {data?.points.length === 0 && (
        <p className="mt-8 rounded-lg border border-[#303030] px-4 py-10 text-center text-sm text-[#999]">
          No rate history available
        </p>
      )}
      {data && data.points.length > 0 && points.length === 0 && (
        <p role="alert" className="mt-8 text-sm text-[#d6a36c]">
          Rate history is available, but its point format could not be displayed.
        </p>
      )}
      {points.length > 0 && (
        <>
          <div className="mt-6 overflow-hidden">
            <svg
              viewBox={"0 0 " + width + " " + height}
              className="h-auto w-full"
              role="img"
              aria-label={`USDC to ${corridor.currency} rate history`}
            >
              {Array.from({ length: 5 }, (_, index) => min + ((max - min) * index) / 4).map((value) => (
                <g key={value}>
                  <line
                    x1={left}
                    x2={width - right}
                    y1={y(value)}
                    y2={y(value)}
                    stroke="#303030"
                    strokeDasharray="3 5"
                  />
                  <text x="0" y={y(value) + 4} fill="#777" fontSize="11">
                    {value.toFixed(2)}
                  </text>
                </g>
              ))}
              <polyline
                points={line}
                fill="none"
                stroke="#a594ff"
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {points.map((point, index) => (
                <circle key={point.time} cx={x(index)} cy={y(point.rate)} r="3" fill="#a594ff" />
              ))}
              {[0, Math.floor((points.length - 1) / 2), points.length - 1]
                .filter((index, position, indices) => indices.indexOf(index) === position)
                .map((index) => (
                  <text key={index} x={x(index)} y={height - 8} textAnchor="middle" fill="#777" fontSize="10">
                    {historyLabel(points[index].time, range, corridor)}
                  </text>
                ))}
            </svg>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[#303030] pt-4">
            <Metric label="Period low" value={format(low)} />
            <Metric label="Period high" value={format(high)} />
          </div>
        </>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------
   PROVIDER COMPARISON
   Displays live quotes from GET /rates/usdc/{currency}/providers.
------------------------------------------------------- */

function ProviderTable({ board, isPending, isError, corridor, format }: {
  board?: RateBoard;
  isPending: boolean;
  isError: boolean;
  corridor: Corridor;
  format: (value: number) => string;
}) {
  const providers = board?.providers ?? [];

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5 sm:p-6">
        <div>
          <Eyebrow>Market comparison</Eyebrow>
          <h3 className="mt-2 text-base font-semibold text-white">Who&apos;s quoting right now</h3>
        </div>
        <span className="rounded-full border border-[#303030] px-3 py-1 text-[10px] text-[#aaa]">
          {isPending ? "Loading providers" : isError ? "Unavailable" : `${providers.filter((p) => p.status === "live").length} live`}
        </span>
      </div>

      {isPending ? (
        <p className="border-t border-[#303030] p-6 text-sm text-[#888]">Loading provider quotes…</p>
      ) : isError ? (
        <p className="border-t border-[#303030] p-6 text-sm text-[#888]">Provider quotes unavailable right now.</p>
      ) : providers.length === 0 ? (
        <p className="border-t border-[#303030] p-6 text-sm text-[#888]">No provider quotes are available for this corridor yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="border-y border-[#303030] text-[9px] font-semibold tracking-wider text-[#777]">
                <th className="px-5 py-4">Provider</th>
                <th className="px-4 py-4">Quote rate</th>
                <th className="px-4 py-4">Fee</th>
                <th className="px-4 py-4">Payout</th>
                <th className="px-4 py-4">Status</th>
                <th className="px-4 py-4">Updated</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => (
                <tr key={provider.provider} className="border-b border-[#292929] last:border-0">
                  <td className="px-5 py-5 text-sm font-semibold text-white">{providerName(provider.provider)}</td>
                  <td className="px-4 py-5 text-xs tabular-nums text-[#ccc]">
                    {provider.rate === null ? EMPTY : format(provider.rate)}
                  </td>
                  <td className="px-4 py-5 text-xs text-[#ccc]">
                    {provider.fee === null ? EMPTY : format(provider.fee / 100)}
                    {provider.fee_percent === null ? "" : ` (${provider.fee_percent}%)`}
                  </td>
                  <td className="px-4 py-5 text-xs font-semibold tabular-nums text-white">
                    {provider.receive === null ? EMPTY : format(provider.receive)}
                  </td>
                  <td className="px-4 py-5">
                    <span className={`rounded-full px-2 py-1 text-[9px] ${
                      provider.status === "live"
                        ? "bg-[#183629] text-[#70d6a3]"
                        : provider.status === "stale"
                          ? "bg-[#382f1e] text-[#e4c17d]"
                          : "bg-[#303030] text-[#999]"
                    }`}>
                      {provider.status}
                    </span>
                    {provider.not_offered_reason && (
                      <p className="mt-1 max-w-36 text-[9px] text-[#777]">{provider.not_offered_reason}</p>
                    )}
                  </td>
                  <td className="px-4 py-5 text-xs text-[#888]">{formatTime(provider.updated_at, corridor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="border-t border-[#303030] p-5 text-[10px] text-[#666]">
        Provider rates and payout amounts are supplied by Fliq&apos;s rate board. Fees are shown in {corridor.currency}.
      </p>
    </Panel>
  );
}

/* -------------------------------------------------------
   CONVERSION BREAKDOWN
   Uses the public after-fee rate for an indicative estimate.
------------------------------------------------------- */

function ConversionPanel({ rate, corridor, format }: { rate?: number; corridor: Corridor; format: (value: number) => string }) {
  const [amount, setAmount] = useState("50");

  const parsedAmount = Number(amount);
  const validAmount =
    amount.trim() !== "" &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0;

  const estimatedReceive =
    rate !== undefined && validAmount
      ? parsedAmount * rate
      : undefined;

  return (
    <Panel className="p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Eyebrow>Indicative conversion</Eyebrow>
          <h3 className="mt-2 text-lg font-semibold text-white">
            What your USDC could become
          </h3>
        </div>
        <span className="rounded-full border border-[#303030] px-3 py-1 text-[10px] text-[#aaa]">
          {rate === undefined ? "Rate unavailable" : "Live rate estimate"}
        </span>
      </div>

      <div className="mt-7">
        <label htmlFor="conversion-amount" className="text-xs text-[#888]">
          You send
        </label>
        <div className="mt-2 flex items-center gap-3 rounded-xl border border-[#383838] bg-[#111] px-4 py-3">
          <span className="text-sm font-semibold text-white">USDC</span>
          <input
            id="conversion-amount"
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="w-full bg-transparent text-right text-xl font-semibold text-white outline-none"
            placeholder="50.00"
          />
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-[#303030] bg-[#111] p-5">
        <p className="text-xs text-[#888]">Estimated {corridor.method} payout</p>
        <p className="mt-3 text-3xl font-semibold tracking-tight text-white">
          {estimatedReceive === undefined ? EMPTY : format(estimatedReceive)}
        </p>
        <p className="mt-2 text-xs text-[#888]">
          {rate === undefined
            ? "Waiting for the live rate."
            : validAmount
              ? `Based on ${format(rate)} per USDC.`
              : "Enter a valid USDC amount to calculate."}
        </p>
      </div>

      <div className="mt-6 space-y-4 border-t border-[#303030] pt-5">
        <div className="flex justify-between gap-4 text-sm">
          <span className="text-[#888]">Exchange rate</span>
          <span className="tabular-nums text-white">
            {rate === undefined ? EMPTY : format(rate)}
          </span>
        </div>
        <div className="flex justify-between gap-4 text-sm">
          <span className="text-[#888]">Provider</span>
          <span className="text-white">
            {rate === undefined ? EMPTY : "Best available route"}
          </span>
        </div>
      </div>

      <p className="mt-5 text-xs leading-6 text-[#888]">
        This is an indicative estimate calculated from Fliq&apos;s public
        after-fee rate. The final payout, provider fees and network fees
        are confirmed when a quote is requested.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/#developers"
          className="rounded-lg bg-[#a594ff] px-4 py-3 text-xs font-semibold text-[#111] transition hover:bg-[#b5a8ff]"
        >
          Get this rate via API
        </Link>
        <button
          onClick={() =>
            navigator.clipboard?.writeText(`https://fliq.cash/rates/${corridor.code}`)
          }
          className="rounded-lg border border-[#383838] px-4 py-3 text-xs text-white hover:bg-white/5"
        >
          Copy link
        </button>
        <a
          href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Compare USDC to ${corridor.currency} rates on fliq`)}&url=${encodeURIComponent(`https://fliq.cash/rates/${corridor.code}`)}`}
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

export function RatesPageClient({ corridor }: { corridor: Corridor }) {
  const money = moneyFormatter(corridor);
  const format = (value: number) => money.format(value);

  const {
    data: rate,
    isPending,
    isError,
    error,
    dataUpdatedAt,
    refetch,
  } = useQuery({
    queryKey: ["public-rate", "usdc", corridor.code],
    queryFn: () => fliqApi<Rate>(`rates/usdc/${corridor.code}`, withTimeout()),
    staleTime: 10_000,
    refetchInterval: (query) => (query.state.status === "error" ? 60_000 : 10_000),
    retry: (failureCount, err) => isRetryable(err) && failureCount < 1,
  });

  const {
    data: rateBoard,
    isPending: providersPending,
    isError: providersError,
  } = useQuery({
    queryKey: ["rate-board", "usdc", corridor.code],
    queryFn: () => fliqApi<RateBoard>(`rates/usdc/${corridor.code}/providers`, withTimeout()),
    staleTime: 10_000,
    refetchInterval: 15_000,
    retry: (failureCount, err) => isRetryable(err) && failureCount < 1,
  });

  const liveRate = rate?.rate;
  const officialRate = rate?.official?.rate;
  const p2pRate = rate?.p2p?.rate;

  const officialDifference =
    rate && officialRate !== undefined
      ? relativeDifference(rate.rate, officialRate)
      : null;

  const p2pDifference =
    rate && p2pRate !== undefined
      ? relativeDifference(rate.rate, p2pRate)
      : null;

  const comingSoon = !rate && isError && isCorridorNotOffered(error);
  const statusLine = rate
    ? `via ${providerName(rate.provider)}`
    : isPending
      ? "Loading the live rate"
      : comingSoon
        ? "Live rates are coming soon"
        : "Live rate unavailable right now";

  return (
    <div className="min-h-screen bg-[#0b0b0b] text-white">
      <SiteHeader activeHref="/rates" />

      <main className={`${siteContainer} pb-20 pt-28`}>
        {/* Breadcrumb */}
        <div className="mb-9 flex flex-wrap items-center gap-2 text-[11px] text-[#777]">
          <Link href="/dashboard" className="hover:text-white">
            Dashboard
          </Link>
          <span>/</span>
          <Link href="/rates" className="hover:text-white">
            Rates
          </Link>
          <span>/</span>
          <span className="text-[#ccc]">{pairTitle(corridor)}</span>
        </div>

        <CurrencySwitcher current={corridor.code} />

        {/* Heading */}
        <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
          <div>
            <Eyebrow>{`fliq rates / ${corridor.country}`}</Eyebrow>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[42px]">{pairTitle(corridor)}</h1>
            <p className="mt-3 text-sm text-[#999]">
              You receive, after fees. Compare the best available payout route.
            </p>
          </div>

          <div className="text-xs text-[#777]">
            <p>{`fliq.cash/rates/${corridor.code}`}</p>
            <p className="mt-1">{`${corridor.currency} · ${corridor.currencyName}`}</p>
          </div>
        </div>

        {/* Main rate */}
        <Panel className="mb-5 p-6 sm:p-9">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <Eyebrow>Best rate after fees · 1 USDC</Eyebrow>
              </div>

              <h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">
                {liveRate === undefined ? (
                  <span className="text-[#555]">{comingSoon ? "Coming soon" : EMPTY}</span>
                ) : (
                  format(liveRate)
                )}
              </h2>

              <p className="mt-3 text-sm text-[#999]">{statusLine}</p>
            </div>

            <div className="min-w-[125px] rounded-xl border border-[#303030] p-4">
              <Eyebrow>24h change</Eyebrow>
              <p
                className={`mt-2 text-xl font-semibold ${
                  rate?.change_24h === undefined ? "text-[#777]" : rate.change_24h < 0 ? "text-[#e48a8a]" : "text-[#70d6a3]"
                }`}
              >
                {rate?.change_24h === undefined ? EMPTY : `${rate.change_24h >= 0 ? "+" : ""}${(rate.change_24h * 100).toFixed(2)}%`}
              </p>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-6 border-t border-[#303030] pt-6 sm:grid-cols-4">
            <Metric
              label={`Official ${corridor.officialReference}`}
              value={formatMoneyOrEmpty(format, officialRate)}
              detail={rate?.official?.source}
            />

            <Metric
              label={`P2P ${corridor.p2pReference}`}
              value={formatMoneyOrEmpty(format, p2pRate)}
              detail={rate?.p2p?.source}
            />

            <Metric
              label="Providers quoting"
              value={rate ? String(rate.providers_quoting) : EMPTY}
              detail="Provider count"
            />

            <Metric
              label="Last updated"
              value={rate ? formatTime(rate.fetched_at, corridor) : EMPTY}
              detail={corridor.cityTime}
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[#303030] pt-4">
            <p className="text-[10px] text-[#777]">
              {!rate
                ? comingSoon
                  ? `fliq does not pay out in ${corridor.currency} yet. This page fills in on its own once it does.`
                  : isPending
                    ? "Fetching the best after-fee rate."
                    : "Rate unavailable right now. It will retry on its own."
                : `Automatically refreshed every 10 seconds · Updated ${formatTime(new Date(dataUpdatedAt).toISOString(), corridor)}`}
            </p>

            <button onClick={() => refetch()} className="text-xs text-[#a594ff] hover:text-white">
              Refresh rate ↗
            </button>
          </div>

          {isError && !comingSoon && (
            <p className="mt-3 text-xs text-[#d6a36c]">
              {error instanceof ApiError
                ? error.message
                : "Rate unavailable right now."}
            </p>
          )}
        </Panel>

        {/* Reference comparisons */}
        <div className="mb-12 grid gap-4 sm:grid-cols-2">
          <Panel className="p-5 sm:p-6">
            <Eyebrow>Official reference</Eyebrow>
            <h3 className="mt-3 text-sm font-semibold text-white">{corridor.officialReference}</h3>
            <p className="mt-4 text-2xl font-semibold tabular-nums">{formatMoneyOrEmpty(format, officialRate)}</p>
            <p className="mt-2 text-xs text-[#888]">
              {officialRate === undefined
                ? "Official reference data is currently unavailable."
                : `fliq's rate is ${differenceLabel(officialDifference)} this reference.`}
            </p>
          </Panel>

          <Panel className="p-5 sm:p-6">
            <Eyebrow>P2P reference</Eyebrow>
            <h3 className="mt-3 text-sm font-semibold text-white">{corridor.p2pReference}</h3>
            <p className="mt-4 text-2xl font-semibold tabular-nums">{formatMoneyOrEmpty(format, p2pRate)}</p>
            <p className="mt-2 text-xs text-[#888]">
              {p2pRate === undefined
                ? "P2P reference data is currently unavailable."
                : `fliq's rate is ${differenceLabel(p2pDifference)} this reference.`}
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
          <RateChart corridor={corridor} format={format} />
        </div>

        {/* Provider table */}
        <div className="mb-12">
          <SectionHeading
            eyebrow="Provider comparison"
            title="Compare live payout routes"
            description={
              providersPending
                ? "Loading provider availability..."
                : providersError
                  ? "Provider availability is temporarily unavailable."
                  : `${rateBoard?.providers.filter((provider) => provider.status === "live").length ?? 0} providers currently quoting. Availability updates automatically.`
            }
          />
          <ProviderTable board={rateBoard} isPending={providersPending} isError={providersError} corridor={corridor} format={format} />
        </div>

        {/* Conversion */}
        <div className="mb-12">
          <ConversionPanel rate={liveRate} corridor={corridor} format={format} />
        </div>

        {/* API response */}
        <div className="mb-12 grid gap-5 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <Eyebrow>For developers</Eyebrow>
            <h2 className="mt-3 text-xl font-semibold">One endpoint. One rate.</h2>
            <p className="mt-3 max-w-md text-sm leading-7 text-[#888]">
              {`Retrieve the current USDC to ${corridor.currency} rate, provider and reference rates through the public fliq API.`}
            </p>
            <p className="mt-5 inline-flex rounded-lg border border-[#303030] px-3 py-2 font-mono text-xs text-[#c5b8ff]">
              {`GET /v1/rates/usdc/${corridor.code}`}
            </p>
          </div>

          <Panel className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#303030] px-5 py-4">
              <span className="text-xs font-semibold text-white">
                {rate ? "Live API response" : "API response"}
              </span>
              {rate && (
                <span className="text-[9px] font-semibold uppercase tracking-wider text-[#8bd5a8]">
                  Live
                </span>
              )}
            </div>
            <pre className="overflow-x-auto p-5 text-xs leading-6 text-[#b9b0d8]">
              {rate
                ? JSON.stringify(rate, null, 2)
                : "Waiting for a live API response..."}
            </pre>
          </Panel>
        </div>

        {/* Other corridors */}
        <div className="mb-12">
          <SectionHeading
            eyebrow="Explore other markets"
            title="Other corridors"
            description="Live after-fee rates for every currency fliq pays out in."
          />
          <CorridorCards exclude={corridor.code} />
        </div>

        {/* Disclaimer */}
        <div className="border-t border-[#303030] pt-6">
          <p className="max-w-3xl text-[10px] leading-6 text-[#777]">
            Rates are quotes from licensed providers, polled every 10 seconds. Not financial advice. Official
            references are shown when the API publishes them. P2P reference is a median of public ads. The
            conversion is an estimate; the payout is fixed when a quote is requested.
          </p>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
