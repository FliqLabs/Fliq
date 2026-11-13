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
import { providerName } from "../../../lib/assets";

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
    <main className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/dashboard" className="text-sm text-app-muted hover:text-app-fg">
            ← All payouts
          </Link>
          <p className="mt-8 text-xs font-semibold uppercase tracking-wide text-app-muted">Receipt</p>
          <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">
            {formatLocalAmount(payout.receive, payout.currency)} to {payout.account_name},{" "}
            {payout.state === "settled" ? "settled" : stateTitle(payout.state)}
          </h1>
        </div>
        <ReceiptActions payout={payout} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section
          aria-label="Receipt summary"
          className="rounded-2xl border border-app-line bg-app-panel p-6 sm:p-7"
        >
          <div className="flex items-start justify-between gap-4 border-b border-app-line pb-6">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-app-panel2 text-lg">
                {payout.account_name.slice(0, 1)}
              </span>
              <div className="min-w-0">
                <h2 className="truncate font-semibold">{payout.account_name}</h2>
                <p className="mt-1 text-sm text-app-muted">
                  Bank code {payout.account.bank} · •••• {payout.account.number.slice(-4)}
                </p>
              </div>
            </div>
            <PayoutStatusBadge state={payout.state} />
          </div>
          <div className="border-b border-app-line py-7">
            <p className="text-sm text-app-muted">
              {payout.state === "settled" ? "Amount received" : "Expected amount"}
            </p>
            <p className="mt-1 text-5xl font-semibold tracking-tight">
              {formatLocalAmount(payout.receive, payout.currency)}
            </p>
            <p className="mt-2 text-sm text-app-muted">for {payout.amount} USDC</p>
          </div>
          <dl className="divide-y divide-app-line text-sm">
            <Detail
              label="Rate"
              value={`${payout.rate.toLocaleString("en-NG")} ${payout.currency.toUpperCase()} / USDC`}
            />
            <Detail
              label="Provider fee"
              value={formatLocalAmount(payout.fees.provider / 100, payout.currency)}
            />
            <Detail
              label="Network fee"
              value={formatLocalAmount(payout.fees.network / 100, payout.currency)}
            />
            <Detail label="Total fees" value={formatLocalAmount(payout.fees.total / 100, payout.currency)} />
            <Detail label="Paid out by" value={providerName(payout.provider)} />
            <Detail label="Payout ID" value={payout.payout_id} copyValue={payout.payout_id} />
          </dl>
        </section>

        <ProofTimeline payout={payout} />
      </div>

      <section className="mt-5 rounded-2xl border border-app-line bg-app-panel p-5 text-sm text-app-muted sm:p-6">
        <p className="font-medium text-app-fg">Transfer details</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <p>Network: {payout.deposit.chain.toUpperCase()}</p>
          <p className="break-all">Vault: {payout.deposit.address}</p>
          {payout.seconds !== null && payout.seconds !== undefined && <p>Time to bank: {payout.seconds}s</p>}
          {payout.bank_reference && <Reference label="Bank reference" value={payout.bank_reference} />}
          {payout.vault_receipt && <Reference label="Vault receipt" value={payout.vault_receipt} />}
          {payout.provider_order && <Reference label="Provider order" value={payout.provider_order} />}
        </div>
      </section>
    </main>
  );
}

function ProofTimeline({ payout }: { payout: Payout }) {
  return (
    <section aria-label="Payout proof" className="rounded-2xl border border-app-line bg-app-panel p-6 sm:p-7">
      <p className="text-xs font-semibold uppercase tracking-wide text-app-muted">Proof</p>
      <ol className="mt-6 space-y-7 border-l border-app-line pl-6">
        {payout.history.map((change, index) => {
          const proof = proofFor(payout, change.state);
          return (
            <li
              key={`${change.state}-${change.at}-${index}`}
              className="relative before:absolute before:top-1 before:-left-[31px] before:size-3 before:rounded-full before:border-2 before:border-app-panel before:bg-app-fg"
            >
              <p className="font-medium">{proof.label}</p>
              <p className="mt-1 text-sm text-app-muted">
                {formatTimestamp(change.at)} UTC · {proof.detail}
              </p>
              {proof.reference && <Reference label="Reference" value={proof.reference} />}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function proofFor(payout: Payout, state: string) {
  if (state === "deposit_seen")
    return {
      label: "Vault deposit recorded",
      detail: `${payout.deposit.amount} USDC on ${payout.deposit.chain.toUpperCase()}`,
      reference: payout.vault_receipt,
    };
  if (state === "with_provider" || state === "paying_out")
    return {
      label: `With ${providerName(payout.provider)}`,
      detail: "Provider payout in progress",
      reference: payout.provider_order,
    };
  if (state === "settled")
    return {
      label: "Bank settlement recorded",
      detail: payout.bank_reference ? "Bank reference received" : "Payout marked settled",
      reference: payout.bank_reference,
    };
  return { label: stateTitle(state), detail: "Payout status recorded", reference: null };
}

function Detail({ label, value, copyValue }: { label: string; value: string; copyValue?: string }) {
  return (
    <div className="flex justify-between gap-4 py-3">
      <dt className="text-app-muted">{label}</dt>
      <dd className="flex max-w-[68%] items-center gap-2 break-all text-right font-medium">
        <span>{value}</span>
        {copyValue && <CopyButton value={copyValue} label={`Copy ${label}`} />}
      </dd>
    </div>
  );
}

function Reference({ label, value }: { label: string; value: string }) {
  return (
    <span className="mt-2 flex min-w-0 items-center gap-2 text-xs text-app-muted">
      <span>{label}:</span>
      <span className="max-w-full break-all rounded-md border border-app-line2 px-2 py-1 font-mono text-app-fg2">
        {value}
      </span>
      <CopyButton value={value} label={`Copy ${label}`} />
    </span>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => navigator.clipboard.writeText(value)}
      className="shrink-0 text-app-muted hover:text-app-fg"
    >
      ⧉
    </button>
  );
}

function stateTitle(state: string) {
  return state.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}
