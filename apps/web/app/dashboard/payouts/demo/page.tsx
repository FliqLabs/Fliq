import { notFound } from "next/navigation";
import { PayoutDetail } from "../[payoutId]/page";
import type { Payout } from "../../payout-model";

type DemoState = "settled" | "awaiting_deposit" | "failed" | "refunded";

const DEMO_STATES: DemoState[] = ["settled", "awaiting_deposit", "failed", "refunded"];

export default async function DemoPayoutPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();

  const params = await searchParams;
  const state = DEMO_STATES.includes(params.state as DemoState) ? (params.state as DemoState) : "settled";

  return (
    <>
      <div className="mb-5 rounded-xl border border-app-warn bg-app-warn-soft px-4 py-3 text-sm text-app-warn">
        <strong>DEMO / TEST DATA</strong> — This receipt is synthetic and never touches a payout or wallet
        API.
        <span className="ml-2">
          Try{" "}
          <a className="underline" href="?state=awaiting_deposit">
            pending
          </a>
          ,{" "}
          <a className="underline" href="?state=failed">
            failed
          </a>
          , or{" "}
          <a className="underline" href="?state=refunded">
            refunded
          </a>
          .
        </span>
      </div>
      <PayoutDetail payout={demoPayout(state)} payoutId="demo_receipt" />
    </>
  );
}

function demoPayout(state: DemoState): Payout {
  const history = {
    settled: [
      { state: "awaiting_deposit" as const, at: "2026-10-29T13:02:10Z" },
      { state: "deposit_seen" as const, at: "2026-10-29T13:02:11Z" },
      { state: "paying_out" as const, at: "2026-10-29T13:02:13Z" },
      { state: "settled" as const, at: "2026-10-29T13:02:32Z" },
    ],
    awaiting_deposit: [{ state: "awaiting_deposit" as const, at: "2026-10-29T13:02:10Z" }],
    failed: [
      { state: "awaiting_deposit" as const, at: "2026-10-29T13:02:10Z" },
      { state: "deposit_seen" as const, at: "2026-10-29T13:02:11Z" },
      { state: "routing" as const, at: "2026-10-29T13:02:12Z" },
      { state: "failed" as const, at: "2026-10-29T13:03:02Z" },
    ],
    refunded: [
      { state: "awaiting_deposit" as const, at: "2026-10-29T13:02:10Z" },
      { state: "deposit_seen" as const, at: "2026-10-29T13:02:11Z" },
      { state: "with_provider" as const, at: "2026-10-29T13:02:14Z" },
      { state: "refunding" as const, at: "2026-10-29T13:03:40Z" },
      { state: "refunded" as const, at: "2026-10-29T13:03:59Z" },
    ],
  } satisfies Record<DemoState, Payout["history"]>;

  return {
    payout_id: `demo_${state}`,
    state,
    account_name: "DARA OKONKWO",
    account: { bank: "058", number: "0123456789" },
    amount: "50.00",
    receive: 68816,
    currency: "ngn",
    rate: 1376.32,
    fees: { provider: 25000, network: 9400, total: 34400 },
    provider: "paycrest",
    deposit: { chain: "near", address: "demo-vault.testnet", amount: "50.00" },
    provider_order: state === "settled" || state === "refunded" ? `demo_provider_${state}` : null,
    vault_receipt: state === "awaiting_deposit" ? null : `demo_vault_${state}`,
    bank_reference: state === "settled" ? "demo_bank_reference" : null,
    seconds: state === "settled" ? 21 : null,
    history: history[state],
  };
}
