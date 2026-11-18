import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import { StatusPageClient } from "./status-page-client";

const outfit = Outfit({ subsets: ["latin"], weight: "700" });

export const metadata: Metadata = {
  title: "System Status | Fliq",
  description: "Live operational status and uptime history for Fliq services and payout providers.",
};

export default function StatusPage() {
  return <StatusPageClient brandClassName={outfit.className} />;
}
