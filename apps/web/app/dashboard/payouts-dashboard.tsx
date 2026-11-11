"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { CreateTestPayoutDrawer } from "./create-test-payout-drawer";
import { FirstLoginDashboard } from "./first-login-dashboard";
import { PayoutExportButton } from "./payout-export-button";
import type { Onboarding } from "../lib/fliq-api";
import { PayoutStatusBadge } from "./components/payout-status-badge";

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
  settledToday: number | null;
  medianSecondsToBank: number | null;
  refusedByVaultCaps: number | null;
  bestRate: number | null;
};

type Props = {
  payouts: PayoutRow[];
  summary: DashboardSummary;
  summaryLoading?: boolean;
  summaryError?: string;
  onboarding?: Onboarding;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
};

export function PayoutsDashboard({
  payouts,
  summary,
  summaryLoading,
  summaryError,
  onboarding,
  hasMore,
  loadingMore,
  onLoadMore,
}: Props) {
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
        <FirstLoginDashboard onCreatePayout={openCreatePayout} onboarding={onboarding} />
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
          className="h-10 w-full max-w-sm rounded-lg border border-app-line px-4 text-sm outline-none placeholder:text-app-dim focus:border-app-accent"
        />
        <div className="flex gap-2">
          <PayoutExportButton />
          <button
            type="button"
            onClick={openCreatePayout}
            className="rounded-lg bg-app-ink px-4 py-2.5 text-xs font-semibold text-app-ink-fg hover:opacity-90"
          >
            Create payout
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Settled today" value={summary.settledToday?.toString() ?? "—"} tone="success" />
        <SummaryCard
          label="Median time to bank"
          value={summary.medianSecondsToBank === null ? "—" : `${summary.medianSecondsToBank}s`}
        />
        <SummaryCard
          label="Refused by vault caps"
          value={summary.refusedByVaultCaps?.toString() ?? "—"}
          tone="danger"
        />
        <SummaryCard
          label="Best rate now"
          value={summary.bestRate === null ? "—" : `₦${summary.bestRate.toFixed(2)}`}
          tone="progress"
        />
      </div>
      {summaryLoading && <p className="mt-2 text-xs text-app-muted">Loading summary metrics…</p>}
      {summaryError && (
        <p role="alert" className="mt-2 text-xs text-app-bad">
          {summaryError}
        </p>
      )}

      <section aria-label="Payouts list" className="mt-4 overflow-hidden rounded-xl border border-app-line">
        <div className="hidden grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-4 border-b border-app-line px-4 py-3 text-[11px] font-semibold uppercase text-app-muted md:grid">
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
              className="mb-4 grid size-10 place-items-center rounded-full bg-app-warn-soft text-app-warn"
            >
              ✦
            </div>
            <h1 className="text-lg font-semibold">No matching payouts</h1>
            <p className="mt-2 max-w-sm text-sm text-app-muted">Try a different name or payout ID.</p>
          </div>
        ) : (
          <div className="divide-y divide-app-line">
            {visiblePayouts.map((payout) => (
              <Link
                key={payout.id}
                href={`/dashboard/payouts/${encodeURIComponent(payout.id)}`}
                className="grid gap-2 px-4 py-4 text-sm hover:bg-app-hover md:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] md:items-center md:gap-4"
              >
                <span>
                  <span className="block font-medium">{payout.recipient}</span>
                  <span className="text-xs text-app-muted">{payout.destination}</span>
                </span>
                <span>
                  {new Intl.NumberFormat("en-NG", { style: "currency", currency: payout.currency }).format(
                    payout.amount,
                  )}
                </span>
                <span>{payout.provider}</span>
                <PayoutStatusBadge state={payout.state} />
                <span>{payout.when}</span>
                <span className="truncate text-xs text-app-muted">{payout.id}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
      {hasMore && onLoadMore && (
        <button
          type="button"
          disabled={loadingMore}
          onClick={onLoadMore}
          className="mt-4 rounded-lg border border-app-line px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
        >
          {loadingMore ? "Loading…" : "Load more payouts"}
        </button>
      )}
      <CreateTestPayoutDrawer dialogRef={drawerRef} />
    </main>
  );
}

function SummaryCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "danger" | "progress";
}) {
  const colors = {
    neutral: { card: "border-app-line", label: "text-app-muted", value: "text-app-fg" },
    success: {
      card: "border-app-good-soft bg-app-good-soft",
      label: "text-app-good",
      value: "text-app-good",
    },
    danger: { card: "border-app-bad-soft bg-app-bad-soft", label: "text-app-bad", value: "text-app-bad" },
    progress: { card: "border-app-accent-soft bg-app-accent-soft", label: "text-app-accent", value: "text-app-accent" },
  }[tone];

  return (
    <div className={`min-h-28 rounded-xl border p-4 ${colors.card}`}>
      <p className={`text-xs ${colors.label}`}>{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${colors.value}`}>{value}</p>
    </div>
  );
}
