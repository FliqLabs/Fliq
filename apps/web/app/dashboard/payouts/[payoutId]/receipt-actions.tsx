"use client";

import type { Payout } from "../../payout-model";
import { useState } from "react";
import { CopyButton } from "../../../components/copy-button";

export function ReceiptActions({ payout }: { payout: Payout }) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1600);
  }

  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <CopyButton text={payout.payout_id} label="Copy payout ID" />
      <button
        type="button"
        onClick={() => copy("link", window.location.href)}
        className="rounded-lg border border-app-line px-4 py-2.5 text-xs font-semibold hover:bg-app-hover"
      >
        {copied === "link" ? "Link copied" : "Copy link"}
      </button>
      <button
        type="button"
        onClick={() => copy("json", JSON.stringify(payout, null, 2))}
        className="rounded-lg border border-app-line px-4 py-2.5 text-xs font-semibold hover:bg-app-hover"
      >
        {copied === "json" ? "JSON copied" : "Raw JSON"}
      </button>
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-lg border border-app-line px-4 py-2.5 text-xs font-semibold hover:bg-app-hover"
      >
        Print receipt
      </button>
    </div>
  );
}
