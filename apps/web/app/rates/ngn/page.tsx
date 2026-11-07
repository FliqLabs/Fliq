import type { Metadata } from "next";
import { RatesPageClient } from "./rates-page-client";

export const metadata: Metadata = {
  title: "USDC to NGN Rates | fliq",
  description: "Compare the live after-fee USDC to Nigerian naira exchange rate on fliq.",
};

export default function NgnRatesPage() {
  return <RatesPageClient />;
}
