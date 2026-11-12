"use client";

import Image from "next/image";
import { useState } from "react";
import { countries } from "./country-select";
import { businessIsComplete, formatFileSize, type BusinessDraft } from "./kyb-state";
import { documentRequirements } from "./pdf-documents";
import documentIcon from "./google-docs.png";

export function KybReview({
  draft,
  files,
  onEditBusiness,
  onEditDocuments,
  onSubmit,
}: {
  draft: BusinessDraft;
  files: Record<number, File>;
  onEditBusiness: () => void;
  onEditDocuments: () => void;
  onSubmit: (keepSandbox: boolean) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [keepSandbox, setKeepSandbox] = useState(true);
  const complete = businessIsComplete(draft) && documentRequirements.every((_, index) => files[index]);
  const fields = [
    ["Legal business name", draft.legalName],
    ["Registration number", draft.registration],
    ["Country", countries.find((country) => country.value === draft.country)?.name ?? "Other"],
    ["Website", draft.website],
    ["Paying out for", draft.purpose],
    ["Expected monthly volume", draft.volume],
    [
      "Corridors",
      countries
        .filter((country) => draft.corridors.includes(country.corridor))
        .map((country) => country.corridorLabel)
        .join(" · "),
    ],
  ];
  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-7">
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold">Business</h2>
          <button
            type="button"
            onClick={onEditBusiness}
            className="cursor-pointer text-xs font-semibold text-app-accent hover:underline"
          >
            Edit business
          </button>
        </div>
        <dl className="divide-y divide-app-line rounded-xl border border-app-line px-4">
          {fields.map(([label, value]) => (
            <div key={label} className="grid gap-1 py-3 text-[13px] sm:grid-cols-[170px_1fr]">
              <dt className="text-app-muted">{label}</dt>
              <dd className="min-w-0 break-words">{value || "Not provided"}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold">Documents</h2>
          <button
            type="button"
            onClick={onEditDocuments}
            className="cursor-pointer text-xs font-semibold text-app-accent hover:underline"
          >
            Edit documents
          </button>
        </div>
        <ul className="divide-y divide-app-line rounded-xl border border-app-line px-4">
          {documentRequirements.map((requirement, index) => (
            <li key={requirement} className="flex items-start gap-3 py-3 text-[13px]">
              <Image src={documentIcon} alt="" className="size-5 shrink-0 object-contain" />
              <span className="min-w-0">
                <span className="block font-medium">{requirement}</span>
                <span className="mt-1 block break-all text-xs text-app-muted">
                  {files[index]
                    ? `${files[index].name} · ${formatFileSize(files[index].size)} · Looks good`
                    : "No PDF selected"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <label className="flex cursor-pointer items-start gap-3 text-[13px] leading-6">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-1 size-4 shrink-0 accent-app-accent"
        />
        <span>
          I am a director of <strong>{draft.legalName || "this business"}</strong>, and the information above
          is true. Provider terms will be presented before a live submission.
        </span>
      </label>
      <label className="flex cursor-pointer items-center gap-3 text-[13px]">
        <input
          type="checkbox"
          checked={keepSandbox}
          onChange={(event) => setKeepSandbox(event.target.checked)}
          className="size-4 accent-app-accent"
        />
        Keep the sandbox key working while the review runs.
      </label>
      <p className="rounded-lg bg-app-warn-soft p-3 text-xs leading-5 text-app-warn">
        Sandbox simulation only. No documents are uploaded, no agreement is accepted, and your existing
        sandbox key remains unchanged.
      </p>
      {!complete && (
        <p role="alert" className="text-xs text-app-bad">
          Complete the business details and all four PDFs before submitting this preview.
        </p>
      )}
      <div className="kyb-actions border-t border-app-line pt-5">
        <button
          type="button"
          onClick={onEditDocuments}
          className="cursor-pointer rounded-lg border border-app-line px-4 py-3 text-sm hover:bg-app-panel2"
        >
          Back
        </button>
        <button
          type="button"
          disabled={!confirmed || !complete}
          onClick={() => onSubmit(keepSandbox)}
          className="cursor-pointer rounded-lg kyb-primary bg-app-ink px-5 py-3 text-sm font-semibold text-app-ink-fg hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Submit for review · sandbox
        </button>
      </div>
    </div>
  );
}

export function ReviewGuidance() {
  return (
    <aside className="kyb-card min-w-0 p-4 sm:p-6">
      <h2 className="text-sm font-bold">After you submit</h2>
      <ol className="mt-5 space-y-6 text-[13px] leading-6">
        {[
          ["Automated checks, about 10 minutes", "CAC lookup, ID match, sanctions."],
          [
            "Compliance review, 1 to 2 business days",
            "A person reads the file. They may ask one question by email.",
          ],
          ["Live", "Once approved, create a live key from API keys."],
        ].map(([title, description], index) => (
          <li key={title} className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-app-panel2 text-xs">
              {index + 1}
            </span>
            <span>
              <strong className="block font-semibold">{title}</strong>
              <span className="text-app-muted">{description}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-5 text-xs leading-5 text-app-warn">
        This preview uses simulated decisions. It will not send emails or activate real-money access.
      </p>
    </aside>
  );
}
