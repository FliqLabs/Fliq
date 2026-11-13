"use client";

import Link from "next/link";
import { useState } from "react";
import { CodeBlock } from "../code-block";
import { playgroundFixtures } from "../playground-fixtures";
import { quickstartExamples } from "./quickstart-examples";

type Language = "curl" | "TypeScript";
const steps = quickstartExamples(
  playgroundFixtures["POST /v1/quote"].quote_id,
  playgroundFixtures.settled.payout_id,
);

export default function QuickstartContent() {
  const [language, setLanguage] = useState<Language>("curl");
  return (
    <>
      <div className="flex flex-col gap-4">
        <p className="text-[11px] font-semibold tracking-[0.1em] text-[var(--accent)] uppercase">
          Start building
        </p>
        <h1 className="text-[28px] leading-[1.15] font-bold tracking-[-0.03em]">
          Your first payout, step by step
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-[var(--fg2)]">
          Explore how fliq works right here in your browser. Read a rate, check a recipient, get a quote and
          preview a payout. Edit the examples and press Run to see what happens.
        </p>
        <ul
          aria-label="Quickstart requirements"
          className="flex flex-wrap gap-x-5 gap-y-2 text-[12px] font-medium text-[var(--fg2)]"
        >
          {["No API key", "No sign-in", "No installation"].map((label) => (
            <li key={label} className="flex items-center gap-2">
              <span aria-hidden="true" className="text-[var(--good)]">
                ✓
              </span>
              {label}
            </li>
          ))}
        </ul>
        <div className="rounded-xl border border-[var(--line)] bg-[var(--panel2)] p-4 text-[13px] leading-6">
          <strong className="block font-semibold">A playground you can try immediately</strong>
          <p className="mt-1 text-[var(--fg2)]">
            These examples run locally with test responses. The Run button doesn’t contact the API or send
            money. The same request shapes are used by the real API, where authentication applies to protected
            endpoints.
          </p>
          <a
            href="#rates"
            className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-[var(--ink)] px-4 text-[12px] font-semibold text-[var(--ink-fg)] transition-opacity hover:opacity-85"
          >
            Try the first example ↓
          </a>
        </div>
        <nav aria-label="Quickstart steps" className="flex flex-wrap gap-2">
          {steps.map((step, index) => (
            <a
              key={step.id}
              href={`#${step.id}`}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-3 py-1.5 text-[12px]"
            >
              <span className="flex size-[18px] items-center justify-center rounded-full bg-[var(--panel2)] text-[11px] font-semibold">
                {index + 1}
              </span>
              {step.title}
            </a>
          ))}
        </nav>
        <div
          role="group"
          aria-label="Example language"
          className="flex w-fit gap-0.5 rounded-[10px] bg-[var(--panel2)] p-[3px]"
        >
          {(["curl", "TypeScript"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={language === option}
              onClick={() => setLanguage(option)}
              className={`cursor-pointer rounded-lg px-3.5 py-2 text-[12px] ${language === option ? "bg-[var(--panel)] font-semibold shadow-sm" : "text-[var(--muted)] hover:text-[var(--fg)]"}`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      {steps.map((step, index) => (
        <section key={step.id} id={step.id} className="flex min-w-0 flex-col gap-3">
          <h2 className="flex items-center gap-3 text-base font-semibold">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-[13px] text-[var(--ink-fg)]">
              {index + 1}
            </span>
            {step.title}
          </h2>
          <p className="text-[13px] leading-6 text-[var(--fg2)]">{step.description}</p>
          <CodeBlock key={language} text={step[language]} />
          <Link href={step.href} className="w-fit text-[12px] font-semibold text-[var(--accent)]">
            {step.link} →
          </Link>
        </section>
      ))}
      <section className="rounded-xl border border-[var(--line)] p-5">
        <h2 className="text-base font-semibold">Keep exploring</h2>
        <p className="mt-2 text-[13px] leading-6 text-[var(--fg2)]">
          Every guide is public, and supported playground examples run without a key. Learn how events arrive,
          explore the SDK, or read about connecting your own app when you’re ready.
        </p>
        <div className="mt-4 grid gap-3 text-[13px] sm:grid-cols-2">
          {[
            { href: "/docs/webhooks", label: "Understand webhook events" },
            { href: "/docs/sdk", label: "Explore the SDK" },
            { href: "/docs/sandbox", label: "See test scenarios" },
            { href: "/docs/authentication", label: "Connect your own app" },
          ].map(({ href, label }) => (
            <Link key={href} href={href} className="rounded-lg bg-[var(--panel2)] p-4 font-medium">
              {label} →
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
