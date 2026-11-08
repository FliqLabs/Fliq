import type { Metadata } from "next";
import { StatusPageClient } from "./status-page-client";

export const metadata: Metadata = {
  title: "System Status | Fliq",
  description: "Live operational status and uptime history for Fliq services and payout providers.",
};

export default function StatusPage() {
  return <StatusPageClient />;
}
