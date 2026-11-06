"use client";

import { useState } from "react";
import Link from "next/link";

const plans = [
  {
    name: "Sandbox",
    price: "$0",
    description: "Every endpoint, mocked providers, mocked Intents. Nothing real moves.",
    features: ["Unlimited test payouts", "Webhooks and replay", "MCP server", "Public rate index"],
    action: "Get a sandbox key",
    href: "/create-workspace",
  },
  {
    name: "Build",
    price: "0.5%",
    suffix: "per payout",
    description: "Live routing to every provider. Free until $50,000 a month, then the fee applies above it.",
    features: ["Best of 4 routing", "Account name verification", "Receipts with bank references", "Agent keys with on-chain caps", "60 requests a minute"],
    action: "Go live after KYB",
    href: "/create-workspace",
  },
  {
    name: "Scale",
    price: "Custom",
    description: "Volume pricing, bulk payouts, higher rate limits and a settlement SLA.",
    features: ["Bulk endpoint", "Dedicated corridors", "Priority provider routing", "SLA and support channel"],
    action: "Talk to us",
    href: "/join-waitlist",
  },
];

export function PricingCards() {
  const [selectedPlan, setSelectedPlan] = useState("Build");
  const [hoveredPlan, setHoveredPlan] = useState<string | null>(null);
  const activePlan = hoveredPlan ?? selectedPlan;

  return (
    <div className="mt-[52px] grid gap-4 md:grid-cols-3" onMouseLeave={() => setHoveredPlan(null)}>
      {plans.map((plan) => (
        <article key={plan.name} onMouseEnter={() => setHoveredPlan(plan.name)} aria-labelledby={`plan-${plan.name.toLowerCase()}`} className={`relative flex flex-col rounded-2xl border p-7 transition-[transform,border-color,background-color,box-shadow] duration-300 ease-out hover:z-10 hover:border-white hover:bg-[#1a1a1a] hover:shadow-xl motion-safe:hover:-translate-y-1 motion-safe:hover:scale-[1.02] motion-reduce:transition-none md:min-h-[460px] ${activePlan === plan.name ? "z-10 border-white bg-[#1a1a1a] shadow-xl motion-safe:scale-[1.02]" : "border-[#2c2c2c]"}`}>
          <h2 id={`plan-${plan.name.toLowerCase()}`} className="text-sm font-bold">
            <button
              type="button"
              aria-pressed={selectedPlan === plan.name}
              onClick={() => setSelectedPlan(plan.name)}
              className="cursor-pointer text-left after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-4 focus-visible:after:outline-white"
            >
              {plan.name}
            </button>
          </h2>
          <p className="mt-6 flex flex-wrap items-baseline gap-2">
            <span className="text-[44px] leading-[53px] tracking-tight">{plan.price}</span>
            {plan.suffix ? <span className="text-sm text-[#a3a3a3]">{plan.suffix}</span> : null}
          </p>
          <p className="mt-5 text-sm leading-[21px] text-[#a3a3a3]">{plan.description}</p>
          <ul className="mt-5 space-y-2 border-t border-[#2c2c2c] pt-2 text-sm leading-[19px]">
            {plan.features.map((feature) => (
              <li key={feature} className="flex gap-3">
                <span aria-hidden="true" className="text-[#32b35a]">✓</span>
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          <div className="mt-auto pt-7">
            <Link href={plan.href} className={`relative z-20 block rounded-xl border px-[18px] py-[13px] text-sm font-bold transition-[transform,background-color,color,border-color,box-shadow] duration-200 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 motion-safe:active:scale-[0.97] motion-reduce:transition-none ${activePlan === plan.name ? "border-white bg-white text-black hover:bg-[#161616] hover:text-white active:bg-zinc-800 active:text-white" : "border-white/50 hover:border-white hover:bg-white hover:text-black active:bg-zinc-200 active:text-black"}`}>
              {plan.action}
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}
