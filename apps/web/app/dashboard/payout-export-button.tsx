"use client";

import { useState } from "react";

export function PayoutExportButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function exportPayouts() {
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/fliq/payouts/export", { credentials: "same-origin" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "Could not export payouts.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "fliq-payouts.csv";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export payouts.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={exportPayouts}
        className="rounded-lg border border-zinc-200 px-4 py-2.5 text-xs font-semibold disabled:opacity-50"
      >
        {pending ? "Exporting…" : "Export CSV"}
      </button>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
