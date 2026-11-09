"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Payout } from "../../payout-model";
import { formatLocalAmount } from "../../payout-model";
import { ApiError, fliqApi } from "../../../lib/fliq-api";

export default function TestPayoutSentPage() {
  return (
    <Suspense fallback={<main className="py-16 text-center text-sm text-zinc-500">Loading payout…</main>}>
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
    return <main className="py-16 text-center text-sm text-zinc-500">Loading payout…</main>;
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
      <main role="alert" className="py-16 text-center text-sm text-red-600">
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
          className="mx-auto grid size-12 place-items-center rounded-full bg-zinc-100 text-xl"
        >
          ↗
        </div>
        <h1 className="mt-5 text-2xl font-semibold">No payout created yet</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Create a payout to see its details here.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-white"
        >
          Back to payouts
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl py-10">
      <div
        className="mx-auto grid size-14 place-items-center rounded-full bg-emerald-50 text-2xl text-emerald-700"
        aria-hidden="true"
      >
        ✓
      </div>
      <h1 className="mt-5 text-center text-2xl font-semibold">
        {payout.provider === "mock" ? "Test payout created" : "Payout order created"}
      </h1>
      <p className="mt-2 text-center text-sm text-zinc-500">
        {payout.provider === "mock"
          ? "The payout is being tracked in your sandbox workspace. Follow its status below."
          : `The ${payout.provider} payout is being tracked. Follow its status below.`}
      </p>
      <section aria-label="Payout summary" className="mt-8 rounded-xl border border-zinc-200 p-6">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-100 pb-5">
          <div>
            <p className="text-xs text-zinc-500">Recipient</p>
            <p className="mt-1 font-semibold">{payout.account_name}</p>
          </div>
          <p className="text-xl font-semibold">{formatLocalAmount(payout.receive, payout.currency)}</p>
        </div>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-zinc-500">Payout ID</dt>
            <dd className="mt-1 font-medium">{payout.payout_id}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Deposit</dt>
            <dd className="mt-1 font-medium">{payout.amount} USDC</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Destination</dt>
            <dd className="mt-1 font-medium">•••• {payout.account.number.slice(-4)}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Status</dt>
            <dd className="mt-1 font-medium capitalize">{payout.state.replaceAll("_", " ")}</dd>
          </div>
        </dl>
      </section>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          href={`/dashboard/payouts/${encodeURIComponent(payout.payout_id)}`}
          className="rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-white"
        >
          View payout detail
        </Link>
        <Link
          href="/dashboard"
          className="rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-semibold"
        >
          Back to payouts
        </Link>
      </div>
    </main>
  );
}
