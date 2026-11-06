import type { Metadata } from "next";
import Link from "next/link";
import type { Payout } from "../../payout-model";
import { formatLocalAmount } from "../../payout-model";

export const metadata: Metadata = { title: "Test payout sent | Fliq" };

export default function TestPayoutSentPage() {
  return <TestPayoutSent payout={null} />;
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
        <h1 className="mt-5 text-2xl font-semibold">No test payout sent yet</h1>
        <p className="mt-2 text-sm text-zinc-500">
          A successful sandbox payout will appear here after it is created.
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
      <h1 className="mt-5 text-center text-2xl font-semibold">Test payout sent</h1>
      <p className="mt-2 text-center text-sm text-zinc-500">
        The payout is being tracked in your sandbox workspace.
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
