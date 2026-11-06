"use client";

import { useState, type RefObject } from "react";

type Props = { dialogRef: RefObject<HTMLDialogElement | null> };
type Corridor = "ngn" | "kes";

export function CreateTestPayoutDrawer({ dialogRef }: Props) {
  const [amount, setAmount] = useState("");
  const [corridor, setCorridor] = useState<Corridor>("ngn");
  const [bank, setBank] = useState("");
  const [accountNumber, setAccountNumber] = useState("");

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="create-payout-title"
      className="fixed inset-y-0 right-0 left-auto z-50 m-0 h-dvh max-h-dvh w-full max-w-[400px] border-l border-zinc-200 bg-white p-0 text-zinc-950 backdrop:bg-black/35"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <h2 id="create-payout-title" className="text-sm font-semibold">
              Create test payout
            </h2>
            <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">
              ● Sandbox
            </span>
          </div>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label="Close drawer"
            className="grid size-8 place-items-center rounded-lg border border-zinc-200 text-lg"
          >
            ×
          </button>
        </div>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => event.preventDefault()}>
          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            <label className="block text-xs font-semibold">
              Amount
              <span className="mt-2 flex h-12 items-center gap-2 rounded-lg border border-zinc-300 px-3 focus-within:border-zinc-700">
                <span className="text-lg font-normal text-zinc-500">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.00"
                  className="min-w-0 flex-1 text-lg font-normal outline-none placeholder:text-zinc-400"
                />
                <span className="rounded-full bg-zinc-100 px-2 py-1 text-[10px]">USDC</span>
              </span>
            </label>
            <p className="text-xs text-zinc-500">
              The live quote and provider will appear after the quote API is connected.
            </p>

            <fieldset>
              <legend className="text-xs font-semibold">Corridor</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <CorridorOption
                  value="ngn"
                  label="🇳🇬 NGN bank"
                  selected={corridor === "ngn"}
                  onChange={setCorridor}
                />
                <CorridorOption
                  value="kes"
                  label="🇰🇪 KES M-Pesa"
                  selected={corridor === "kes"}
                  onChange={setCorridor}
                />
              </div>
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold">
                {corridor === "ngn" ? "Bank code" : "Provider code"}
                <input
                  type="text"
                  value={bank}
                  onChange={(event) => setBank(event.target.value)}
                  placeholder="Enter code"
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-200 px-3 font-normal outline-none focus:border-zinc-500"
                />
              </label>
              <label className="block text-xs font-semibold">
                Account number
                <input
                  inputMode="numeric"
                  value={accountNumber}
                  onChange={(event) => setAccountNumber(event.target.value)}
                  placeholder="Enter number"
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-200 px-3 font-normal outline-none focus:border-zinc-500"
                />
              </label>
            </div>
            <div className="rounded-lg bg-zinc-50 p-3 text-xs text-zinc-500">
              Account verification will show the recipient name here before anything moves.
            </div>
            <details className="border-t border-zinc-100 pt-4 text-xs text-zinc-500">
              <summary className="cursor-pointer">Advanced: reference, idempotency key, metadata</summary>
              <p className="mt-3">These options become available when payout submission is connected.</p>
            </details>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                The same request, as code
              </p>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-zinc-950 p-4 text-xs leading-5 text-zinc-300">{`POST /payouts\n{\n  "quote_id": "<quote from API>",\n  "account": { "bank": "${bank}", "number": "${accountNumber}" }\n}`}</pre>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-zinc-200 p-5">
            <p className="text-xs text-zinc-500">Quote and payout submission are coming soon.</p>
            <button
              type="submit"
              disabled
              className="shrink-0 rounded-lg bg-zinc-950 px-4 py-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send test payout
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}

function CorridorOption({
  value,
  label,
  selected,
  onChange,
}: {
  value: Corridor;
  label: string;
  selected: boolean;
  onChange: (value: Corridor) => void;
}) {
  return (
    <label
      className={`flex h-11 cursor-pointer items-center justify-between rounded-lg border px-3 text-xs ${selected ? "border-zinc-800" : "border-zinc-200 text-zinc-500"}`}
    >
      <span>{label}</span>
      <input
        type="radio"
        name="corridor"
        value={value}
        checked={selected}
        onChange={() => onChange(value)}
        className="accent-zinc-950"
      />
    </label>
  );
}
