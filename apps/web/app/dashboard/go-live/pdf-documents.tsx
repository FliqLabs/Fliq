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
    <div className="space-y-5 p-6">
      <div>
        <h2 className="text-lg font-bold">Upload your documents</h2>
        <p className="mt-2 text-sm leading-6 text-[#6b6b6b]">
          Choose one PDF for each requirement. Up to 20 MB per file.
        </p>
      </div>
      <p className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">
        Sandbox preview: files stay in this browser session. They are not sent to a provider and are cleared
        when you sign out or reload.
      </p>
      <div className="space-y-4">
        {documentRequirements.map((requirement, index) => (
          <section
            key={requirement}
            aria-labelledby={`document-title-${index}`}
            className="rounded-xl border border-[#e6e6e6] p-4"
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
              className="relative mt-3 flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-5 text-center transition-colors hover:border-blue-500 hover:bg-blue-50 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-blue-600"
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
              <span className="text-sm font-semibold text-blue-700">
                {files[index] ? "Replace PDF" : "Choose PDF"}
              </span>
              <span className="text-xs text-zinc-500">or drag and drop it here</span>
            </label>
            {files[index] && (
              <div className="mt-3 flex items-start justify-between gap-3 text-xs">
                <p className="min-w-0 break-all text-zinc-600">
                  {files[index].name} · {formatFileSize(files[index].size)} ·{" "}
                  <span className="text-emerald-700">Looks good</span>
                </p>
                <button
                  type="button"
                  onClick={() => fileInputs.current[index]?.click()}
                  className="cursor-pointer font-semibold text-blue-700 hover:underline"
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
                  className="cursor-pointer font-semibold text-red-600 hover:underline"
                  aria-label={`Remove ${requirement}`}
                >
                  Remove
                </button>
              </div>
            )}
            {errors[index] && (
              <p id={`document-error-${index}`} role="alert" className="mt-2 text-xs text-red-700">
                {errors[index]}
              </p>
            )}
          </section>
        ))}
      </div>
      <p role="status" className="text-xs text-zinc-500">
        {Object.keys(files).length} of {documentRequirements.length} PDFs selected.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#e6e6e6] pt-5">
        <button
          type="button"
          onClick={onBack}
          className="cursor-pointer rounded-lg border border-zinc-200 px-4 py-3 text-sm hover:bg-zinc-50"
        >
          Back to business
        </button>
        <button
          type="button"
          disabled={
            !documentRequirements.every((_, index) => files[index]) || Object.values(errors).some(Boolean)
          }
          onClick={onContinue}
          className="cursor-pointer rounded-lg bg-zinc-950 px-4 py-3 text-sm font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Continue to review
        </button>
      </div>
    </div>
  );
}
