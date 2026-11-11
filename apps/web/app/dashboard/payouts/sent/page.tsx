"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Payout } from "../../payout-model";
import { formatLocalAmount } from "../../payout-model";
import { ApiError, fliqApi } from "../../../lib/fliq-api";
import { PayoutStatusBadge, payoutStatusTone } from "../../components/payout-status-badge";

export default function TestPayoutSentPage() {
  return (
    <Suspense fallback={<main className="py-16 text-center text-sm text-app-muted">Loading payout…</main>}>
      <SentPayoutData />
    </Suspense>
  );
}

function SentPayoutData() {
  const payoutId = useSearchParams().get("payoutId");
  const payout = useQuery({
    queryKey: ["payout", payoutId],
    queryFn: () => fliqApi<Payout>(`payouts/${encodeURIComponent(payoutId!)}`),
    enabled: Boolean(payoutId),
  });
  if (!payoutId) return <TestPayoutSent payout={null} />;
  if (payout.isPending)
    return <main className="py-16 text-center text-sm text-app-muted">Loading payout…</main>;
  if (payout.error instanceof ApiError && payout.error.status === 401) {
    return (
      <main className="py-16 text-center">
        <Link href="/sign-in" className="text-sm font-semibold underline">
          Sign in to view this payout
        </Link>
      </main>
    );
  }
  if (payout.isError)
    return (
      <main role="alert" className="py-16 text-center text-sm text-app-bad">
        {payout.error.message}
      </main>
    );
  return <TestPayoutSent payout={payout.data} />;
}

export function TestPayoutSent({ payout }: { payout: Payout | null }) {
  if (!payout) {
    return (
      <main className="mx-auto max-w-2xl py-16 text-center">
        <div
          aria-hidden="true"
          className="mx-auto grid size-12 place-items-center rounded-full bg-app-panel2 text-xl"
        >
          ↗
        </div>
        <h1 className="mt-5 text-2xl font-semibold">No payout created yet</h1>
<<<<<<< HEAD
        <p className="mt-2 text-sm text-zinc-500">Create a payout to see its details here.</p>
=======
        <p className="mt-2 text-sm text-app-muted">Create a payout to see its details here.</p>
>>>>>>> 52b2e07c9f81bc0e97433462c0f73623f3156322
        <Link
          href="/dashboard"
          className="mt-6 inline-flex rounded-lg bg-app-ink px-4 py-2.5 text-sm font-semibold text-app-ink-fg"
        >
          Back to payouts
        </Link>
      </main>
    );
  }

  const tone = payoutStatusTone(payout.state);

  return (
    <main className="mx-auto max-w-2xl py-10">
      <div
<<<<<<< HEAD
        className={`mx-auto grid size-14 place-items-center rounded-full text-2xl ${tone === "success" ? "bg-emerald-50 text-emerald-700" : tone === "danger" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}
=======
        className={`mx-auto grid size-14 place-items-center rounded-full text-2xl ${tone === "success" ? "bg-app-good-soft text-app-good" : tone === "danger" ? "bg-app-bad-soft text-app-bad" : "bg-app-warn-soft text-app-warn"}`}
>>>>>>> 52b2e07c9f81bc0e97433462c0f73623f3156322
        aria-hidden="true"
      >
        {tone === "success" ? "✓" : tone === "danger" ? "!" : "↗"}
      </div>
      <h1 className="mt-5 text-center text-2xl font-semibold">
        {payout.provider === "mock" ? "Test payout created" : "Payout order created"}
      </h1>
      <p className="mt-2 text-center text-sm text-app-muted">
        {payout.provider === "mock"
          ? "The payout is being tracked in your sandbox workspace. Follow its status below."
          : `The ${payout.provider} payout is being tracked. Follow its status below.`}
      </p>
      <section aria-label="Payout summary" className="mt-8 rounded-xl border border-app-line p-6">
        <div className="flex items-start justify-between gap-4 border-b border-app-line pb-5">
          <div>
            <p className="text-xs text-app-muted">Recipient</p>
            <p className="mt-1 font-semibold">{payout.account_name}</p>
          </div>
          <p className="text-xl font-semibold">{formatLocalAmount(payout.receive, payout.currency)}</p>
        </div>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-app-muted">Payout ID</dt>
            <dd className="mt-1 font-medium">{payout.payout_id}</dd>
          </div>
          <div>
            <dt className="text-app-muted">Deposit</dt>
            <dd className="mt-1 font-medium">{payout.amount} USDC</dd>
          </div>
          <div>
            <dt className="text-app-muted">Destination</dt>
            <dd className="mt-1 font-medium">•••• {payout.account.number.slice(-4)}</dd>
          </div>
          <div>
<<<<<<< HEAD
            <dt className="text-zinc-500">Status</dt>
=======
            <dt className="text-app-muted">Status</dt>
>>>>>>> 52b2e07c9f81bc0e97433462c0f73623f3156322
            <dd className="mt-1">
              <PayoutStatusBadge state={payout.state} />
            </dd>
          </div>
        </dl>
      </section>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          href={`/dashboard/payouts/${encodeURIComponent(payout.payout_id)}`}
          className="rounded-lg bg-app-ink px-4 py-2.5 text-sm font-semibold text-app-ink-fg"
        >
          View payout detail
        </Link>
        <Link
          href="/dashboard"
          className="rounded-lg border border-app-line px-4 py-2.5 text-sm font-semibold"
        >
          Back to payouts
        </Link>
      </div>
    </main>
  );
}
