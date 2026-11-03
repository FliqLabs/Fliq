import type { Metadata } from "next";
import { PayoutsDashboard, type DashboardSummary, type PayoutRow } from "./payouts-dashboard";

export const metadata: Metadata = {
  title: "Payouts | Fliq",
  description: "View payouts in your Fliq workspace.",
};

const summary: DashboardSummary = {
  settledToday: 0,
  medianSecondsToBank: 0,
  refusedByVaultCaps: 0,
  bestRate: 0,
};

const payouts: PayoutRow[] = [];

export default function DashboardPage() {
  return <PayoutsDashboard summary={summary} payouts={payouts} />;
}
