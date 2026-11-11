"use client";

import Image from "next/image";
import { CopyButton } from "../components/copy-button";
import { useState } from "react";
import fliqMark from "../image/fliq image.png";
import type { Onboarding } from "../lib/fliq-api";
import { PayoutExportButton } from "./payout-export-button";

type Props = { onCreatePayout: () => void; onboarding?: Onboarding };
type ExampleLanguage = "curl" | "TypeScript";

const examples: Record<ExampleLanguage, string> = {
  curl: `curl -X POST https://api.fliq.cash/v1/quote \\
  -H "Authorization: Bearer <YOUR_SANDBOX_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{"token":"usdc","currency":"ngn","amount":"<USDC_AMOUNT>"}'`,
  TypeScript: `const response = await fetch("https://api.fliq.cash/v1/quote", {
  method: "POST",
  headers: {
    Authorization: "Bearer <YOUR_SANDBOX_KEY>",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    token: "usdc",
    currency: "ngn",
    amount: "<USDC_AMOUNT>",
  }),
});`,
};

export function FirstLoginDashboard({ onCreatePayout, onboarding }: Props) {
  const [showSteps, setShowSteps] = useState(true);
  const [language, setLanguage] = useState<ExampleLanguage>("curl");

  return (
    <>
      {showSteps ? (
        <section
          aria-label="Getting started"
          className="grid grid-cols-1 md:grid-cols-[30%_30%_30%_5%] items-center gap-4 rounded-xl border border-zinc-200 px-4 py-3 text-xs"
        >
          <div className="flex items-center justify-between">
            <Step
              number={1}
              title="Create a payout"
              description="Get a quote to see the provider"
              active
              done={onboarding?.steps.find((step) => step.id === "create_test_payout")?.done}
            />
            <span aria-hidden="true" className="hidden h-px max-w-6 flex-1 bg-zinc-200 md:block" />
          </div>

          <div className="flex items-center justify-between">
            <Step
              number={2}
              title="Add a webhook endpoint"
              description="Receive payout events"
              done={onboarding?.steps.find((step) => step.id === "add_webhook")?.done}
            />
            <span aria-hidden="true" className="hidden h-px max-w-6 flex-1 bg-zinc-200 md:block" />
          </div>

          <div className="flex items-center justify-between">
            <Step
              number={3}
              title="Go live after KYB"
              description="Enable live payouts"
              done={onboarding?.steps.find((step) => step.id === "go_live")?.done}
            />
          </div>

          <button
            type="button"
            onClick={() => setShowSteps(false)}
            className="ml-auto text-xs text-zinc-500 hover:text-zinc-950"
          >
            Hide
          </button>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => setShowSteps(true)}
          className="text-xs text-zinc-500 hover:text-zinc-950"
        >
          Show getting started
        </button>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <input
          aria-label="Search payouts"
          disabled
          placeholder="Search by name, payout ID, NIP reference"
          className="h-10 w-full max-w-sm rounded-lg border border-zinc-200 px-4 text-sm placeholder:text-zinc-400 disabled:bg-zinc-50"
        />
        <div className="flex gap-2">
          <PayoutExportButton />
          <button
            type="button"
            onClick={onCreatePayout}
            className="rounded-lg bg-zinc-950 px-4 py-2.5 text-xs font-semibold text-white hover:bg-zinc-800"
          >
            Create payout
          </button>
        </div>
      </div>

      <section aria-label="Payouts list" className="mt-4 overflow-hidden rounded-xl border border-zinc-200">
        <div className="hidden grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-4 border-b border-zinc-200 px-4 py-3 text-[11px] font-semibold uppercase text-zinc-500 md:grid">
          <span>Recipient</span>
          <span>Amount</span>
          <span>Provider</span>
          <span>State</span>
          <span>When</span>
          <span>Payout</span>
        </div>
        <div className="flex min-h-[400px] flex-col items-center justify-center px-5 py-6 text-center">
          <div className="relative mb-4">
            <Image src={fliqMark} alt="" className="size-16 object-contain" />
            <span
              aria-hidden="true"
              className="absolute right-0 bottom-0 grid size-5 place-items-center rounded-full bg-amber-50 text-[9px] text-amber-700"
            >
              ●
            </span>
          </div>
          <h1 className="text-lg font-semibold">No payouts yet. Create your first payout.</h1>
          <p className="mt-2 max-w-lg text-sm text-zinc-500">
            Your payouts will appear here once you create one. Get a quote to see which provider will
            handle it, then connect a webhook endpoint to follow its status.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={onCreatePayout}
              className="rounded-lg bg-zinc-950 px-4 py-2.5 text-xs font-semibold text-white hover:bg-zinc-800"
            >
              Create payout
            </button>
            <a
              href="#quickstart"
              className="rounded-lg border border-zinc-200 px-4 py-2.5 text-xs font-semibold hover:bg-zinc-50"
            >
              Read the quickstart
            </a>
          </div>

          <div id="quickstart" className="mt-7 w-full max-w-xl scroll-mt-20 text-left">
            <div className="flex items-center justify-between gap-3">
              <div
                role="group"
                aria-label="Quickstart language"
                className="flex rounded-lg bg-zinc-100 p-1 text-xs"
              >
                {(["curl", "TypeScript"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={language === option}
                    onClick={() => {
                      setLanguage(option);
                    }}
                    className={`rounded-md px-3 py-1.5 ${language === option ? "bg-white font-semibold shadow-sm" : "text-zinc-500"}`}
                  >
                    {option}
                  </button>
                ))}
                <span className="px-3 py-1.5 text-zinc-400" title="MCP example is not available yet">
                  MCP
                </span>
              </div>
              <CopyButton text={examples[language]} />
            </div>
            <pre
              id="quickstart-example"
              className="mt-2 overflow-x-auto rounded-lg bg-zinc-950 p-4 font-mono text-xs leading-5 text-zinc-100"
            >
              {examples[language]}
            </pre>
            <p className="mt-2 text-xs text-zinc-500">
              Replace the placeholders with your sandbox key and amount. Create a payout with the quote ID
              returned by this request.
            </p>
          </div>
        </div>
      </section>
      <p className="mt-3 text-xs text-zinc-500">
        <span className="text-amber-500">●</span> Check the provider on your quote before creating a payout.
      </p>
    </>
  );
}

function Step({
  number,
  title,
  description,
  active = false,
  done = false,
}: {
  number: number;
  title: string;
  description: string;
  active?: boolean;
  done?: boolean;
}) {
  return (
    <div className="flex min-w-40 items-center gap-2">
      <span
        className={`grid size-6 shrink-0 place-items-center rounded-full text-[11px] ${active ? "bg-zinc-950 text-white" : "border border-zinc-200 text-zinc-500"}`}
      >
        {done ? "✓" : number}
      </span>
      <span>
        <span className={`block font-semibold ${active ? "text-zinc-950" : "text-zinc-500"}`}>{title}</span>
        <span className="block text-[11px] text-zinc-500">{description}</span>
      </span>
    </div>
  );
}
