"use client";

export function ReceiptActions({ payoutId }: { payoutId: string }) {
  return (
    <div className="mt-6 flex flex-wrap gap-2 border-t border-zinc-100 pt-6 print:hidden">
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-lg bg-zinc-950 px-4 py-2.5 text-xs font-semibold text-white"
      >
        Print receipt
      </button>
      <button
        type="button"
        onClick={() => navigator.clipboard.writeText(payoutId)}
        className="rounded-lg border border-zinc-200 px-4 py-2.5 text-xs font-semibold"
      >
        Copy payout ID
      </button>
    </div>
  );
}
