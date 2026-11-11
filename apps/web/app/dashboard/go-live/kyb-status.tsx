"use client";

import Image from "next/image";
import Link from "next/link";
import { countries } from "./country-select";
import type { BusinessDraft, KybDecision } from "./kyb-state";
import yellowIcon from "./yellow icon.png";
import flashIcon from "./flash image.png";
import blueStarIcon from "./blue star.png";

function time(value?: string) {
  return value
    ? new Date(value).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Africa/Lagos",
      }) + " WAT"
    : "Not submitted";
}

export function KybStatus({
  decision,
  draft,
  onApprove,
  onEdit,
  fileCount,
}: {
  decision: KybDecision;
  draft: BusinessDraft;
  onApprove: () => void;
  onEdit: () => void;
  fileCount: number;
}) {
  const approved = decision.status === "approved";
  const opened = countries.filter((country) => draft.corridors.includes(country.corridor));
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.85fr)_minmax(300px,1fr)]">
      <section className="rounded-xl border border-[#e6e6e6] p-6">
        <span
          className={`inline-flex rounded-full px-3 py-1.5 text-xs font-bold ${approved ? "bg-emerald-50 text-emerald-800" : "bg-[#fff3d6] text-[#8a5a00]"}`}
        >
          {approved ? "Approved · sandbox simulation" : "Under review · sandbox simulation"}
        </span>
        <h2 className="mt-5 text-2xl font-bold">{approved ? "Three things to do next" : "Under review"}</h2>
        <p className="mt-2 text-sm leading-6 text-[#6b6b6b]">
          {approved
            ? `${draft.legalName} passed the simulated review. This does not enable real payouts.`
            : `Submitted ${time(decision.submittedAt)}. Your business details and ${fileCount} PDFs are held in this browser session.`}
        </p>
        {!approved ? (
          <>
            <ol className="my-7 space-y-6">
              {[
                ["Submitted", "Business details and documents selected."],
                ["Automated checks", "CAC lookup, ID match and sanctions checks are simulated."],
                ["Compliance review", "A real reviewer would review the application next."],
                ["Live", "The production flow enables live access only after actual approval."],
              ].map(([title, description], index) => (
                <li key={title} className="flex items-start gap-3 text-sm">
                  <span
                    className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs ${index === 0 ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-500"}`}
                  >
                    {index === 0 ? "✓" : index + 1}
                  </span>
                  <span>
                    <strong className="block font-semibold">{title}</strong>
                    <span className="mt-1 block text-[13px] leading-6 text-[#6b6b6b]">{description}</span>
                  </span>
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/dashboard/api-keys"
                className="rounded-lg bg-zinc-950 px-4 py-3 text-sm font-semibold text-white hover:bg-zinc-700"
              >
                Back to API keys
              </Link>
              <Link
                href="/dashboard"
                className="rounded-lg border border-zinc-200 px-4 py-3 text-sm hover:bg-zinc-50"
              >
                Keep testing in sandbox
              </Link>
            </div>
            <button
              type="button"
              onClick={onApprove}
              className="mt-5 cursor-pointer text-xs font-semibold text-blue-700 hover:underline"
            >
              Sandbox: simulate approval
            </button>
          </>
        ) : (
          <>
            <ol className="mt-6 divide-y divide-zinc-100">
              {[
                [
                  "Create a live key",
                  "Set caps that match your payroll run. Preview keys will not authenticate with the API.",
                  "/dashboard/api-keys/new-live",
                  "New live key",
                ],
                [
                  "Fund the live vault",
                  "Real deposit instructions require an enabled live workspace.",
                  "/docs/vault-contract",
                  "Vault guide",
                ],
                [
                  "Point webhooks at production",
                  "Keep your test endpoint on sandbox and configure the live endpoint after approval.",
                  "/dashboard/webhooks",
                  "Add endpoint",
                ],
              ].map(([title, description, href, label], index) => (
                <li key={title} className="flex flex-wrap items-center gap-4 py-5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-xs text-white">
                    {index + 1}
                  </span>
                  <span className="min-w-[160px] flex-1">
                    <strong className="block text-sm">{title}</strong>
                    <span className="mt-1 block text-[13px] leading-5 text-[#6b6b6b]">{description}</span>
                  </span>
                  <Link
                    href={href}
                    className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-semibold hover:bg-zinc-50"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ol>
            <section className="mt-5 rounded-xl bg-[#f6f6f6] p-5">
              <h3 className="text-sm font-bold">Your live limits</h3>
              <dl className="mt-4 grid gap-4 text-[13px] sm:grid-cols-3">
                <div>
                  <dt className="text-[#6b6b6b]">Per payout</dt>
                  <dd className="mt-1">Set at live approval</dd>
                </div>
                <div>
                  <dt className="text-[#6b6b6b]">Per day</dt>
                  <dd className="mt-1">Set at live approval</dd>
                </div>
                <div>
                  <dt className="text-[#6b6b6b]">Corridors requested</dt>
                  <dd className="mt-1">{opened.length}</dd>
                </div>
              </dl>
              <p className="mt-4 text-xs text-[#6b6b6b]">
                {opened.map((country) => country.corridorLabel).join(" · ")}
              </p>
            </section>
            <p className="mt-4 text-xs text-[#6b6b6b]">Simulated approval: {time(decision.approvedAt)}</p>
          </>
        )}
        <button
          type="button"
          onClick={onEdit}
          className="mt-6 cursor-pointer text-xs text-zinc-500 underline"
        >
          View or edit this preview application
        </button>
      </section>
      <aside className="rounded-xl border border-[#e6e6e6] p-6">
        <h2 className="text-sm font-bold">{approved ? "Providers opened for you" : "While you wait"}</h2>
        {approved ? (
          <div className="mt-5 space-y-5">
            {[
              { name: "Paycrest", description: "NGN bank", icon: yellowIcon },
              { name: "Busha", description: "NGN bank, KES M-Pesa", icon: flashIcon },
              { name: "Fonbnk", description: "NGN mobile money", icon: blueStarIcon },
            ].map(({ name, description, icon }) => (
              <div key={name} className="flex items-start gap-3">
                <Image src={icon} alt="" className="size-6 shrink-0 object-contain" />
                <span className="flex-1 text-[13px]">
                  <strong className="block">{name}</strong>
                  <span className="text-xs text-[#6b6b6b]">{description}</span>
                </span>
                <span className="rounded bg-emerald-50 px-2 py-1 text-[10px] text-emerald-800">Preview</span>
              </div>
            ))}
            <p className="border-t border-zinc-100 pt-4 text-xs text-[#6b6b6b]">Bitnob · Paused by fliq</p>
          </div>
        ) : (
          <ul className="mt-5 space-y-4 text-[13px] leading-6 text-[#6b6b6b]">
            <li>
              {decision.keepSandbox === false
                ? "Your preview requests sandbox access to be paused. The real key remains unchanged."
                : "Your existing sandbox key keeps working."}
            </li>
            <li>Wire your webhook endpoint so your app can handle payout events.</li>
            <li>The production reviewer may contact the workspace owner for more information.</li>
          </ul>
        )}
        <p className="mt-5 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">
          Nothing on this page grants real-money access. No provider has received your PDFs.
        </p>
      </aside>
    </div>
  );
}
