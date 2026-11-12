"use client";

import { useState } from "react";

export function CopyButton({ text, label = "Copy", disabled = false }: { text: string; label?: string; disabled?: boolean }) {
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [error, setError] = useState(false);

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={disabled}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopiedText(text);
            setError(false);
          } catch {
            setError(true);
          }
        }}
        className="cursor-pointer whitespace-nowrap rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 active:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {copiedText === text ? "Copied!" : label}
      </button>
      <span role="status" className="sr-only">{copiedText === text ? "Copied!" : ""}</span>
      {error && <span role="alert" className="text-xs text-red-600">Could not copy. Please copy manually.</span>}
    </span>
  );
}
