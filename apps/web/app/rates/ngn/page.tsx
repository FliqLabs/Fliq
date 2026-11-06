import type { Metadata } from "next";
import { RatesPageClient } from "./rates-page-client";

export const metadata: Metadata = {
  title: "USDC to NGN Rates | Fliq",
  description:
    "Compare the live after-fee USDC to Nigerian naira exchange rate on Fliq.",
};

export default function NgnRatesPage() {
  return <RatesPageClient />;
}
