"use client";

import Link from "next/link";
import { useState } from "react";
import { CodeBlock } from "../code-block";

type Language = "curl" | "TypeScript" | "MCP";
const examples: Record<Language, string[]> = {
  curl: [
    '# Create your workspace in the dashboard.\n# Copy the test key shown once after creation.\nexport FLIQ_KEY="<YOUR_TEST_KEY>"',
    `curl -X POST https://fliq-yclq.onrender.com/v1/quote \\
  -H "Authorization: Bearer $FLIQ_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"token":"usdc","currency":"ngn","amount":"50.00"}'`,
    `curl -X POST https://fliq-yclq.onrender.com/v1/payouts \\
  -H "Authorization: Bearer $FLIQ_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: <UNIQUE_REQUEST_KEY>" \\
  -d '{"quote_id":"<QUOTE_ID>","account":{"bank":"058","number":"0123456789"}}'`,
    "# Listen for signed payout state changes on your server.\n# Verify the signature before updating your records.\n# payout.settled means the provider confirmed payment.",
  ],
  TypeScript: [
    "// Create your workspace in the dashboard.\n// Keep the key on your server, never in browser code.\nconst key = process.env.FLIQ_KEY;",
    `const response = await fetch("https://fliq-yclq.onrender.com/v1/quote", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.FLIQ_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ token: "usdc", currency: "ngn", amount: "50.00" }),
});
if (!response.ok) throw new Error("Quote request failed");
const quote = await response.json();`,
    `const response = await fetch("https://fliq-yclq.onrender.com/v1/payouts", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.FLIQ_KEY}\`,
    "Content-Type": "application/json",
    "Idempotency-Key": crypto.randomUUID(),
  },
  body: JSON.stringify({ quote_id: quote.quote_id, account: { bank: "058", number: "0123456789" } }),
});
if (!response.ok) throw new Error("Payout request failed");
const payout = await response.json();`,
    "// Verify the raw webhook body and signature on your server.\n// Use the webhook guide for event shapes and verification.\n// Only mark a payout paid after a verified payout.settled event.",
  ],
  MCP: [
    "# Agent integration preview\n# Issue a scoped agent key with vault-enforced caps.\n# See Agents and MCP for the proposed configuration.",
    "// Proposed agent flow\n// Request a quote for USDC → NGN, amount 50.00.\n// Read the rate, provider and expiration before confirming.",
    "// Verify the recipient account name.\n// Request a payout within the owner’s on-chain caps.\n// The vault must refuse a request above those caps.",
    "// Watch for a verified settled event.\n// A stablecoin transfer alone does not prove bank payment.",
  ],
};
const steps = [
  {
    title: "Get a key",
    description:
      "Create a developer workspace. Its default sandbox key is shown once; copy it before leaving the creation screen.",
    output: "Authorization: Bearer <YOUR_TEST_KEY>",
    href: "/dashboard/api-keys",
    link: "Open API keys",
  },
  {
    title: "Quote",
    description:
      "Four providers are asked in parallel. You get the best after-fee rate and how long it holds.",
    output:
      '{ "quote_id": "q_31ad77e0", "rate": 1376.32,\n  "receive": 68816, "provider": "paycrest", "expires_in": 90 }',
    href: "/docs/quotes",
    link: "Read about quotes",
  },
  {
    title: "Pay",
    description:
      "Use a current quote and the verified recipient. Reuse the same idempotency key when retrying the same payout.",
    output:
      "# Use the payout_id from your actual response.\n# Deposit instructions depend on the selected route.",
    href: "/docs/payouts",
    link: "Read about payouts",
  },
  {
    title: "Watch the webhook",
    description:
      "Every state change carries the payout ID. Verify the signature, then update your app when payment is confirmed.",
    output: "payout.deposit_seen → payout.paying_out → payout.settled",
    href: "/docs/webhooks",
    link: "Verify webhook events",
  },
];

export default function QuickstartContent() {
  const [language, setLanguage] = useState<Language>("curl");
  return (
    <>
      <div className="flex flex-col gap-3.5">
        <h1 className="text-[28px] leading-[1.1] font-bold tracking-[-0.03em]">
          Pay out $50 to a Nigerian bank
          <br />
          in four calls
        </h1>
        <p className="text-sm leading-6 text-[#6b6b6b]">
          Get a key, quote, pay, watch the webhook. Start in sandbox with the canonical demo recipient.
        </p>
        <nav aria-label="Quickstart steps" className="flex flex-wrap gap-2">
          {["Key", "Quote", "Pay", "Webhook"].map((title, index) => (
            <a
              key={title}
              href={`#s${index + 1}`}
              className="inline-flex items-center gap-2 rounded-full border border-[#e6e6e6] px-3 py-1.5 text-[12px]"
            >
              <span className="flex size-[18px] items-center justify-center rounded-full bg-[#111] text-[11px] text-white">
                {index + 1}
              </span>
              {title}
            </a>
          ))}
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e6e6e6] bg-[#f6f6f6] px-3.5 py-3 text-[13px]">
          <span className="flex items-center gap-2.5">
            <span aria-hidden="true" className="size-2 rounded-full bg-[#e8a317]" />
            Your sandbox key is available at workspace creation.
          </span>
          <Link
            href="/dashboard/api-keys"
            className="rounded-[10px] border border-[#e6e6e6] bg-white px-3.5 py-2 text-[12px] font-semibold"
          >
            View keys
          </Link>
        </div>
        <div
          role="group"
          aria-label="Example language"
          className="flex w-fit flex-wrap gap-0.5 rounded-[10px] bg-[#f6f6f6] p-[3px]"
        >
          {(["curl", "TypeScript", "MCP"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === language}
              onClick={() => setLanguage(option)}
              className={`cursor-pointer rounded-lg px-3.5 py-2 text-[12px] ${language === option ? "bg-white font-semibold shadow-sm" : "text-[#6b6b6b] hover:text-zinc-950"}`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      {steps.map((step, index) => (
        <section key={step.title} id={`s${index + 1}`} className="flex flex-col gap-3">
          <h2 className="flex items-center gap-3 text-base font-semibold">
            <span className="flex size-7 items-center justify-center rounded-full bg-[#111] text-[13px] text-white">
              {index + 1}
            </span>
            {step.title}
          </h2>
          <p className="text-[13px] leading-6 text-[#6b6b6b]">{step.description}</p>
          <CodeBlock key={language} text={examples[language][index]} />
          <p className="text-[11px] font-semibold text-zinc-500">
            {index === 1 ? "Example response" : "Keep in mind"}
          </p>
          <CodeBlock text={step.output} />
          <Link href={step.href} className="w-fit text-[12px] font-semibold">
            {step.link} →
          </Link>
        </section>
      ))}
      <section className="rounded-xl border border-[#e6e6e6] p-5">
        <h2 className="text-base font-semibold">What next?</h2>
        <div className="mt-4 grid gap-4 text-[13px] sm:grid-cols-2">
          <Link href="/docs/agents" className="rounded-lg bg-zinc-50 p-4">
            Give your agent a capped key →
          </Link>
          <Link href="/dashboard/go-live" className="rounded-lg bg-zinc-50 p-4">
            Prepare your business for live payouts →
          </Link>
        </div>
      </section>
    </>
  );
}
