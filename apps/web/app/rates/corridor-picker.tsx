"use client";

import Link from "next/link";
import { useQueries } from "@tanstack/react-query";
import { fliqApi } from "../lib/fliq-api";
import { CORRIDORS, type Corridor, moneyFormatter, pairTitle, withTimeout } from "../lib/corridors";

type PublicRate = { rate: number; provider: string; providers_quoting: number; fetched_at: string };

/* One rate per corridor, shared with the corridor page through the same query key. A corridor the config calls
   coming soon still turns live here once the API answers for it. */
function useCorridorRates() {
  return useQueries({
    queries: CORRIDORS.map((corridor) => ({
      queryKey: ["public-rate", "usdc", corridor.code],
      queryFn: () => fliqApi<PublicRate>(`rates/usdc/${corridor.code}`, withTimeout()),
      staleTime: 10_000,
      refetchInterval: 60_000,
      retry: false,
    })),
  }).map((query, index) => ({ corridor: CORRIDORS[index], rate: query.data, isPending: query.isPending }));
}

function updatedAt(value: string, corridor: Corridor) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: corridor.timeZone }).format(date);
}

export function CurrencySwitcher({ current }: { current: string }) {
  const corridors = useCorridorRates();

  return (
    <nav aria-label="Choose a currency" className="mb-9 flex flex-wrap gap-2">
      {corridors.map(({ corridor, rate }) => {
        const live = corridor.live || rate !== undefined;
        const selected = corridor.code === current;
        const pill = "inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs transition";
        if (!live) {
          return (
            <span
              key={corridor.code}
              aria-disabled="true"
              className={`${pill} cursor-not-allowed border-[#262626] text-[#555]`}
            >
              <span aria-hidden="true">{corridor.flag}</span>
              {corridor.currency}
              <span className="text-[9px] uppercase tracking-wider">Coming soon</span>
            </span>
          );
        }
        return (
          <Link
            key={corridor.code}
            href={`/rates/${corridor.code}`}
            aria-current={selected ? "page" : undefined}
            className={`${pill} ${selected ? "border-[#a594ff] bg-[#a594ff]/10 text-white" : "border-[#303030] text-[#ccc] hover:text-white"}`}
          >
            <span aria-hidden="true">{corridor.flag}</span>
            {corridor.currency}
            <span className="text-[#777]">{corridor.country}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function CorridorCards({ exclude }: { exclude?: string }) {
  const corridors = useCorridorRates().filter(({ corridor }) => corridor.code !== exclude);

  return (
    <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
      {corridors.map(({ corridor, rate, isPending }) => {
        const live = corridor.live || rate !== undefined;
        const body = (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white">
                <span aria-hidden="true">{corridor.flag} </span>
                {pairTitle(corridor)}
              </p>
              {!live && (
                <span className="rounded-full border border-[#303030] px-2 py-0.5 text-[9px] uppercase tracking-wider text-[#777]">
                  Coming soon
                </span>
              )}
            </div>
            <p className="mt-4 text-xl font-semibold tabular-nums">
              {rate ? moneyFormatter(corridor).format(rate.rate) : live && isPending ? "-" : live ? "Rate unavailable right now" : corridor.currencyName}
            </p>
            <p className="mt-2 text-xs text-[#777]">
              {rate
                ? `${rate.provider.charAt(0).toUpperCase() + rate.provider.slice(1)} · best of ${rate.providers_quoting} · ${updatedAt(rate.fetched_at, corridor)} ${corridor.cityTime}`
                : live
                  ? "Best rate after fees, per 1 USDC"
                  : `Payouts to ${corridor.country} are on the way`}
            </p>
          </>
        );
        return live ? (
          <Link
            key={corridor.code}
            href={`/rates/${corridor.code}`}
            className="rounded-xl border border-[#303030] bg-[#141414] p-5 transition hover:border-[#4a4a4a]"
          >
            {body}
          </Link>
        ) : (
          <section key={corridor.code} className="rounded-xl border border-[#262626] bg-[#111] p-5 opacity-60">
            {body}
          </section>
        );
      })}
    </div>
  );
}
