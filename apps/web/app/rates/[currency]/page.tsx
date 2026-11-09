import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CORRIDORS, corridorFor } from "../../lib/corridors";
import { RatesPageClient } from "../rates-page-client";

export function generateStaticParams() {
  return CORRIDORS.map((corridor) => ({ currency: corridor.code }));
}

export async function generateMetadata({ params }: { params: Promise<{ currency: string }> }): Promise<Metadata> {
  const corridor = corridorFor((await params).currency);
  if (!corridor) return {};
  return {
    title: `USDC to ${corridor.currency} Rates | fliq`,
    description: `Compare the live after-fee USDC to ${corridor.currencyName} exchange rate on fliq.`,
  };
}

export default async function CorridorRatesPage({ params }: { params: Promise<{ currency: string }> }) {
  const corridor = corridorFor((await params).currency);
  if (!corridor) notFound();
  return <RatesPageClient corridor={corridor} />;
}
