"use client";

export function ReceiptActions({ payoutId }: { payoutId: string }) {
  return (
    <div className="mt-6 flex flex-wrap gap-2 border-t border-app-line pt-6 print:hidden">
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-lg bg-app-ink px-4 py-2.5 text-xs font-semibold text-app-ink-fg"
      >
        Print receipt
      </button>
      <button
        type="button"
        onClick={() => navigator.clipboard.writeText(payoutId)}
        className="rounded-lg border border-app-line px-4 py-2.5 text-xs font-semibold"
      >
        Copy payout ID
      </button>
    </div>
  );
}
