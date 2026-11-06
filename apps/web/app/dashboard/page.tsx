import type { Metadata } from "next";
import { DashboardData } from "./dashboard-data";

export const metadata: Metadata = {
  title: "Payouts | Fliq",
  description: "View payouts in your Fliq workspace.",
};

export default function DashboardPage() {
  return <DashboardData />;
}
