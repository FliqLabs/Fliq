"use client";

import { useRef, useState } from "react";

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

  return (
    <main>
      <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between border-b border-zinc-200 bg-white px-6 lg:fixed lg:right-0 lg:left-[232px] lg:px-8">
        <h1 className="text-sm font-semibold">Payouts</h1>
        <div className="flex items-center gap-4 text-xs">
          <span className="rounded-full bg-amber-50 px-3 py-1.5 font-semibold text-amber-700">● Sandbox</span>
          <span className="text-zinc-400">Live</span>
        </div>
      </header>

      <div className="mx-auto max-w-[1440px] px-5 py-7 lg:px-8 lg:pt-[92px]">
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
              <h2 className="text-lg font-semibold">No payouts available</h2>
              <p className="mt-2 max-w-sm text-sm text-zinc-500">
                {payouts.length === 0
                  ? "Create your first test payout in the sandbox."
                  : "No payouts match your search."}
              </p>
              {payouts.length === 0 && (
                <button
                  type="button"
                  onClick={openCreatePayout}
                  className="mt-5 rounded-lg bg-zinc-950 px-4 py-2.5 text-xs font-semibold text-white hover:bg-zinc-800"
                >
                  Create test payout
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-zinc-100">
              {visiblePayouts.map((payout) => (
                <div
                  key={payout.id}
                  className="grid gap-2 px-4 py-4 text-sm md:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] md:items-center md:gap-4"
                >
                  <div>
                    <p className="font-medium">{payout.recipient}</p>
                    <p className="text-xs text-zinc-500">{payout.destination}</p>
                  </div>
                  <span>
                    {new Intl.NumberFormat("en-NG", { style: "currency", currency: payout.currency }).format(
                      payout.amount,
                    )}
                  </span>
                  <span>{payout.provider}</span>
                  <span>{payout.state}</span>
                  <span>{payout.when}</span>
                  <span className="truncate text-xs text-zinc-500">{payout.id}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <dialog
        ref={drawerRef}
        aria-labelledby="create-payout-title"
        className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-full max-w-[520px] border-l border-zinc-200 bg-white p-0 text-zinc-950 backdrop:bg-black/40"
      >
        <div className="flex min-h-full flex-col">
          <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-5">
            <div className="flex items-center gap-2">
              <h2 id="create-payout-title" className="text-sm font-semibold">
                Create test payout
              </h2>
              <span className="rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-700">Sandbox</span>
            </div>
            <button
              type="button"
              onClick={() => drawerRef.current?.close()}
              aria-label="Close"
              className="rounded-lg border border-zinc-200 px-3 py-1.5"
            >
              ×
            </button>
          </div>
          <div className="flex-1 space-y-5 p-6">
            <label className="block text-xs font-semibold">
              Amount in USDC
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                className="mt-2 h-12 w-full rounded-lg border border-zinc-200 px-4 text-lg font-normal outline-none focus:border-zinc-500"
              />
            </label>
            <label className="block text-xs font-semibold">
              Corridor
              <select className="mt-2 h-12 w-full rounded-lg border border-zinc-200 px-4 font-normal">
                <option value="">Select a corridor</option>
                <option value="ngn">NGN bank</option>
                <option value="kes">KES M-Pesa</option>
              </select>
            </label>
            <label className="block text-xs font-semibold">
              Bank or provider
              <input
                type="text"
                placeholder="Choose a bank or provider"
                className="mt-2 h-12 w-full rounded-lg border border-zinc-200 px-4 font-normal outline-none focus:border-zinc-500"
              />
            </label>
            <label className="block text-xs font-semibold">
              Account number
              <input
                inputMode="numeric"
                placeholder="Enter account number"
                className="mt-2 h-12 w-full rounded-lg border border-zinc-200 px-4 font-normal outline-none focus:border-zinc-500"
              />
            </label>
            <p className="text-xs text-zinc-500">
              Quotes, account verification, and payout submission will be available when the backend is
              connected.
            </p>
          </div>
          <div className="border-t border-zinc-200 p-6">
            <button
              type="button"
              disabled
              className="w-full rounded-lg bg-zinc-950 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send test payout
            </button>
          </div>
        </div>
      </dialog>
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
