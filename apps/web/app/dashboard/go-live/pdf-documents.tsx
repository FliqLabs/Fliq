"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { formatFileSize, useKybFiles } from "./kyb-state";
import documentIcon from "./google-docs.png";

export const documentRequirements = [
  "Certificate of incorporation (PDF)",
  "Government ID of one director",
  "Proof of business address, under 3 months old",
  "Source of funds, one bank statement",
];

export function PdfDocuments({
  userId,
  onBack,
  onContinue,
}: {
  userId: string;
  onBack: () => void;
  onContinue: () => void;
}) {
  const { files, setFiles } = useKybFiles(userId);
  const fileInputs = useRef<Record<number, HTMLInputElement | null>>({});
  const versions = useRef<Record<number, number>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});

  async function chooseFile(index: number, file: File | undefined) {
    if (!file) return;
    const version = (versions.current[index] ?? 0) + 1;
    versions.current[index] = version;
    let error = "";
    try {
      if (file.size > 20 * 1024 * 1024) error = "Choose a PDF smaller than 20 MB.";
      else if (!file.name.toLowerCase().endsWith(".pdf") || (await file.slice(0, 5).text()) !== "%PDF-")
        error = "Choose a valid PDF document.";
    } catch {
      error = "Could not read this file. Please select it again.";
    }
    if (versions.current[index] !== version) return;
    setErrors((current) => ({ ...current, [index]: error }));
    if (!error) setFiles((current) => ({ ...current, [index]: file }));
  }

  return (
    <div className="space-y-5 p-4 sm:p-6 lg:p-7">
      <div>
        <h2 className="text-lg font-bold">Upload your documents</h2>
        <p className="mt-2 text-sm leading-6 text-app-muted">
          Choose one PDF for each requirement. Up to 20 MB per file.
        </p>
      </div>
      <p className="rounded-lg bg-app-warn-soft p-3 text-xs leading-5 text-app-warn">
        Sandbox preview: files stay in this browser session. They are not sent to a provider and are cleared
        when you sign out or reload.
      </p>
      <div className="space-y-4">
        {documentRequirements.map((requirement, index) => (
          <section
            key={requirement}
            aria-labelledby={`document-title-${index}`}
            className="rounded-xl border border-app-line p-4"
          >
            <h3 id={`document-title-${index}`} className="flex items-start gap-2 text-sm font-semibold">
              <Image src={documentIcon} alt="" className="size-5 shrink-0 object-contain" />
              {requirement}
            </h3>
            <label
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void chooseFile(index, event.dataTransfer.files[0]);
              }}
              className="relative mt-3 flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-app-line2 bg-app-panel2 p-5 text-center transition-colors hover:border-app-accent hover:bg-app-accent-soft focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-app-accent"
            >
              <input
                ref={(element) => {
                  fileInputs.current[index] = element;
                }}
                type="file"
                accept=".pdf,application/pdf"
                aria-label={`Upload ${requirement}`}
                aria-describedby={errors[index] ? `document-error-${index}` : undefined}
                aria-invalid={Boolean(errors[index])}
                onChange={(event) => {
                  void chooseFile(index, event.target.files?.[0]);
                  event.target.value = "";
                }}
                className="absolute inset-0 w-full cursor-pointer opacity-0"
              />
              <span className="text-sm font-semibold text-app-accent">
                {files[index] ? "Replace PDF" : "Choose PDF"}
              </span>
              <span className="text-xs text-app-muted">or drag and drop it here</span>
            </label>
            {files[index] && (
              <div className="mt-3 flex flex-wrap items-start gap-x-4 gap-y-2 text-xs">
                <p className="min-w-0 basis-full break-all text-app-fg2 sm:flex-1 sm:basis-auto">
                  {files[index].name} · {formatFileSize(files[index].size)} ·{" "}
                  <span className="text-app-good">Looks good</span>
                </p>
                <button
                  type="button"
                  onClick={() => fileInputs.current[index]?.click()}
                  className="cursor-pointer font-semibold text-app-accent hover:underline"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={() => {
                    versions.current[index] = (versions.current[index] ?? 0) + 1;
                    setFiles((current) => {
                      const next = { ...current };
                      delete next[index];
                      return next;
                    });
                    setErrors((current) => ({ ...current, [index]: "" }));
                  }}
                  className="cursor-pointer font-semibold text-app-bad hover:underline"
                  aria-label={`Remove ${requirement}`}
                >
                  Remove
                </button>
              </div>
            )}
            {errors[index] && (
              <p id={`document-error-${index}`} role="alert" className="mt-2 text-xs text-app-bad">
                {errors[index]}
              </p>
            )}
          </section>
        ))}
      </div>
      <p role="status" className="text-xs text-app-muted">
        {Object.keys(files).length} of {documentRequirements.length} PDFs selected.
      </p>
      <div className="kyb-actions border-t border-app-line pt-5">
        <button
          type="button"
          onClick={onBack}
          className="cursor-pointer rounded-lg border border-app-line px-4 py-3 text-sm hover:bg-app-panel2"
        >
          Back to business
        </button>
        <button
          type="button"
          disabled={
            !documentRequirements.every((_, index) => files[index]) || Object.values(errors).some(Boolean)
          }
          onClick={onContinue}
          className="cursor-pointer rounded-lg kyb-primary bg-app-ink px-5 py-3 text-sm font-semibold text-app-ink-fg hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Continue to review
        </button>
      </div>
    </div>
  );
}
