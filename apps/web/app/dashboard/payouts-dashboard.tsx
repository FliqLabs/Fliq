"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { CreateTestPayoutDrawer } from "./create-test-payout-drawer";
import { FirstLoginDashboard } from "./first-login-dashboard";

export type PayoutRow = {
  id: string;
  recipient: string;
  destination: string;
  amount: number;
  currency: string;
  provider: string;
  state: string;
  when: string;
};

export type DashboardSummary = {
  settledToday: number;
  medianSecondsToBank: number;
  refusedByVaultCaps: number;
  bestRate: number;
};

type Props = {
  payouts: PayoutRow[];
  summary: DashboardSummary;
};

export function PayoutsDashboard({ payouts, summary }: Props) {
  const [search, setSearch] = useState("");
  const drawerRef = useRef<HTMLDialogElement>(null);
  const visiblePayouts = payouts.filter((payout) =>
    [payout.recipient, payout.id, payout.destination].some((value) =>
      value.toLowerCase().includes(search.toLowerCase()),
    ),
  );

  function openCreatePayout() {
    drawerRef.current?.showModal();
  }

  if (payouts.length === 0) {
    return (
      <main>
        <FirstLoginDashboard onCreatePayout={openCreatePayout} />
        <CreateTestPayoutDrawer dialogRef={drawerRef} />
      </main>
    );
  }

  return (
    <main>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <label className="sr-only" htmlFor="payout-search">
          Search payouts
        </label>
        <input
          id="payout-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name or payout ID"
          className="h-10 w-full max-w-sm rounded-lg border border-zinc-200 px-4 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500"
        />
        <div className="flex gap-2">
          <button
            type="button"
            disabled
            className="rounded-lg border border-zinc-200 px-4 py-2.5 text-xs font-semibold text-zinc-400"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={openCreatePayout}
            className="rounded-lg bg-zinc-950 px-4 py-2.5 text-xs font-semibold text-white hover:bg-zinc-800"
          >
            Create test payout
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Settled today" value={String(summary.settledToday)} />
        <SummaryCard label="Median time to bank" value={`${summary.medianSecondsToBank}s`} />
        <SummaryCard label="Refused by vault caps" value={String(summary.refusedByVaultCaps)} />
        <SummaryCard label="Best rate now" value={`₦${summary.bestRate.toFixed(2)}`} />
      </div>

      <section aria-label="Payouts list" className="mt-4 overflow-hidden rounded-xl border border-zinc-200">
        <div className="hidden grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-4 border-b border-zinc-200 px-4 py-3 text-[11px] font-semibold uppercase text-zinc-500 md:grid">
          <span>Recipient</span>
          <span>Amount</span>
          <span>Provider</span>
          <span>State</span>
          <span>When</span>
          <span>Payout</span>
        </div>
        {visiblePayouts.length === 0 ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center px-5 py-14 text-center">
            <div
              aria-hidden="true"
              className="mb-4 grid size-10 place-items-center rounded-full bg-amber-50 text-amber-600"
            >
              ✦
            </div>
            <h1 className="text-lg font-semibold">No matching payouts</h1>
            <p className="mt-2 max-w-sm text-sm text-zinc-500">Try a different name or payout ID.</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {visiblePayouts.map((payout) => (
              <Link
                key={payout.id}
                href={`/dashboard/payouts/${encodeURIComponent(payout.id)}`}
                className="grid gap-2 px-4 py-4 text-sm hover:bg-zinc-50 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] md:items-center md:gap-4"
              >
                <span>
                  <span className="block font-medium">{payout.recipient}</span>
                  <span className="text-xs text-zinc-500">{payout.destination}</span>
                </span>
                <span>
                  {new Intl.NumberFormat("en-NG", { style: "currency", currency: payout.currency }).format(
                    payout.amount,
                  )}
                </span>
                <span>{payout.provider}</span>
                <span>{payout.state}</span>
                <span>{payout.when}</span>
                <span className="truncate text-xs text-zinc-500">{payout.id}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
      <CreateTestPayoutDrawer dialogRef={drawerRef} />
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-h-28 rounded-xl border border-zinc-200 p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}
