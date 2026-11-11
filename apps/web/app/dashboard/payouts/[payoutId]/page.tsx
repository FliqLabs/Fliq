"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Payout } from "../../payout-model";
import { formatLocalAmount, formatTimestamp } from "../../payout-model";
import { ApiError, fliqApi } from "../../../lib/fliq-api";
import { ReceiptActions } from "./receipt-actions";
import { PayoutStatusBadge } from "../../components/payout-status-badge";

export default function PayoutDetailPage() {
  return (
    <Suspense
      fallback={<main className="py-16 text-center text-sm text-app-muted">Loading payout detail…</main>}
    >
      <PayoutDetailData />
    </Suspense>
  );
}

function PayoutDetailData() {
  const { payoutId } = useParams<{ payoutId: string }>();
  const payout = useQuery({
    queryKey: ["payout", payoutId],
    queryFn: () => fliqApi<Payout>(`payouts/${encodeURIComponent(payoutId)}`),
  });

  if (payout.isPending)
    return <main className="py-16 text-center text-sm text-app-muted">Loading payout detail…</main>;
  if (payout.error instanceof ApiError && payout.error.status === 401) {
    return (
      <main className="py-16 text-center">
        <Link href="/sign-in" className="text-sm font-semibold underline">
          Sign in to view this payout
        </Link>
      </main>
    );
  }
  if (payout.error instanceof ApiError && payout.error.status === 404) {
    return <PayoutDetail payout={null} payoutId={payoutId} />;
  }
  if (payout.isError)
    return (
      <main role="alert" className="py-16 text-center text-sm text-app-bad">
        {payout.error.message}
      </main>
    );
  return <PayoutDetail payout={payout.data} payoutId={payoutId} />;
}

export function PayoutDetail({ payout, payoutId }: { payout: Payout | null; payoutId: string }) {
  if (!payout) {
    return (
      <main className="mx-auto max-w-2xl py-16 text-center">
        <h1 className="text-2xl font-semibold">Payout detail unavailable</h1>
        <p className="mt-2 text-sm text-app-muted">There is no payout data to display for {payoutId} yet.</p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex rounded-lg bg-app-ink px-4 py-2.5 text-sm font-semibold text-app-ink-fg"
        >
          Back to payouts
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl">
      <Link href="/dashboard" className="text-sm text-app-muted hover:text-app-fg">
        ← All payouts
      </Link>
      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-app-muted">Payout detail</p>
          <h1 className="mt-1 text-2xl font-semibold">{payout.payout_id}</h1>
          <p className="mt-1 text-sm text-app-muted">Track the transfer and view its receipt.</p>
        </div>
        <PayoutStatusBadge state={payout.state} />
      </div>

      <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section
          aria-label="Receipt"
          className="rounded-xl border border-app-line bg-app-panel p-6 shadow-sm sm:p-8"
        >
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-app-line pb-6">
            <div>
              <p className="text-sm font-bold">fliq</p>
<<<<<<< HEAD
              <p className="mt-1 text-xs text-zinc-500">
=======
              <p className="mt-1 text-xs text-app-muted">
>>>>>>> 52b2e07c9f81bc0e97433462c0f73623f3156322
                {payout.state === "settled" ? "Payout receipt" : "Payout details"}
              </p>
            </div>
            <p className="text-xs text-app-muted">
              {payout.history.at(-1) ? formatTimestamp(payout.history.at(-1)!.at) : ""} UTC
            </p>
          </div>
<<<<<<< HEAD
          <div className="border-b border-zinc-100 py-8 text-center">
            <p className="text-sm text-zinc-500">
=======
          <div className="border-b border-app-line py-8 text-center">
            <p className="text-sm text-app-muted">
>>>>>>> 52b2e07c9f81bc0e97433462c0f73623f3156322
              {payout.state === "settled" ? "Amount received" : "Expected amount"}
            </p>
            <p className="mt-2 text-3xl font-semibold">
              {formatLocalAmount(payout.receive, payout.currency)}
            </p>
            <div className="mt-3 flex justify-center">
              <PayoutStatusBadge state={payout.state} />
            </div>
          </div>
          <dl className="divide-y divide-app-line text-sm">
            <Detail label="Recipient" value={payout.account_name} />
            <Detail label="Account number" value={`•••• ${payout.account.number.slice(-4)}`} />
            <Detail label="Bank code" value={payout.account.bank} />
            <Detail label="Amount" value={`${payout.amount} USDC`} />
            <Detail
              label="Rate"
              value={`${payout.rate.toLocaleString("en-NG")} ${payout.currency.toUpperCase()} / USDC`}
            />
            <Detail label="Provider" value={payout.provider} />
            {payout.bank_reference && <Detail label="Bank reference" value={payout.bank_reference} />}
            {payout.vault_receipt && <Detail label="Vault receipt" value={payout.vault_receipt} />}
            {payout.provider_order && <Detail label="Provider order" value={payout.provider_order} />}
            <Detail label="Payout ID" value={payout.payout_id} />
          </dl>
          <ReceiptActions payoutId={payout.payout_id} />
        </section>

        <aside className="space-y-5">
          <section className="rounded-xl border border-app-line p-5">
            <h2 className="text-sm font-semibold">Timeline</h2>
            <ol className="mt-5 space-y-5 border-l border-app-line pl-4">
              {payout.history.map((change) => (
                <li
                  key={`${change.state}-${change.at}`}
                  className="relative text-xs before:absolute before:top-1 before:-left-[21px] before:size-2.5 before:rounded-full before:bg-app-fg"
                >
                  <PayoutStatusBadge state={change.state} />
<<<<<<< HEAD
                  <p className="mt-1 text-zinc-500">{formatTimestamp(change.at)} UTC</p>
=======
                  <p className="mt-1 text-app-muted">{formatTimestamp(change.at)} UTC</p>
>>>>>>> 52b2e07c9f81bc0e97433462c0f73623f3156322
                </li>
              ))}
            </ol>
          </section>
          <section className="rounded-xl border border-app-line p-5 text-xs">
            <h2 className="text-sm font-semibold">Transfer details</h2>
            <p className="mt-3 text-app-muted">Network: {payout.deposit.chain.toUpperCase()}</p>
            <p className="mt-2 break-all text-app-muted">Vault: {payout.deposit.address}</p>
            {payout.seconds !== null && payout.seconds !== undefined && (
              <p className="mt-2 text-app-muted">Time to bank: {payout.seconds}s</p>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-3">
      <dt className="text-app-muted">{label}</dt>
      <dd className="max-w-[60%] break-all text-right font-medium">{value}</dd>
    </div>
  );
}
