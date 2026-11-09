import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "../components/site-header";
import { SiteFooter } from "../components/site-footer";
import { siteContainer } from "../components/site-container";
import { CorridorCards } from "./corridor-picker";

export const metadata: Metadata = {
  title: "USDC to local currency rates | fliq",
  description: "Live after-fee USDC rates for every currency fliq pays out in.",
};

export default function RatesIndexPage() {
  return (
    <div className="min-h-screen bg-[#0b0b0b] text-white">
      <SiteHeader activeHref="/rates" />

      <main className={`${siteContainer} pb-20 pt-28`}>
        <div className="mb-9 flex flex-wrap items-center gap-2 text-[11px] text-[#777]">
          <Link href="/dashboard" className="hover:text-white">
            Dashboard
          </Link>
          <span>/</span>
          <span className="text-[#ccc]">Rates</span>
        </div>

        <div className="mb-8">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#999]">fliq rates</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[42px]">USDC to local money</h1>
          <p className="mt-3 max-w-xl text-sm text-[#999]">
            What 1 USDC lands as after every fee, across each currency fliq pays out in. Pick one to compare
            providers, see its history and estimate a payout.
          </p>
        </div>

        <CorridorCards />

        <div className="mt-12 border-t border-[#303030] pt-6">
          <p className="max-w-3xl text-[10px] leading-6 text-[#777]">
            Rates are quotes from licensed providers, refreshed every minute here and every 10 seconds on each
            currency&apos;s page. Not financial advice. Currencies marked coming soon turn live on their own once
            fliq can pay out in them.
          </p>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
