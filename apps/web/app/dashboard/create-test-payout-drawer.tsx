"use client";

import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fliqApi, type Institution, type Quote, type VerifiedAccount } from "../lib/fliq-api";
import type { Payout } from "./payout-model";

type Props = { dialogRef: RefObject<HTMLDialogElement | null> };
type Corridor = "ngn" | "kes";

export function CreateTestPayoutDrawer({ dialogRef }: Props) {
  const [amount, setAmount] = useState("");
  const [corridor, setCorridor] = useState<Corridor>("ngn");
  const [bank, setBank] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [clientReference, setClientReference] = useState("");
  const [quote, setQuote] = useState<{ value: Quote; key: string; expiresAt: number }>();
  const [verified, setVerified] = useState<{ value: VerifiedAccount; key: string }>();
  const [now, setNow] = useState(0);
  const idempotencyKey = useRef<string | null>(null);
  const queryClient = useQueryClient();

  const country = corridor === "ngn" ? "ng" : "ke";
  const payoutType = corridor === "ngn" ? "bank" : "mobile_money";
  const quoteKey = `${amount}:${corridor}`;
  const accountKey = `${country}:${bank}:${accountNumber}:${accountName.trim()}`;
  const currentQuote = quote?.key === quoteKey && quote.expiresAt > now ? quote.value : null;
  const currentAccount = verified?.key === accountKey ? verified.value : null;
  const institutions = useQuery({
    queryKey: ["institutions", country],
    queryFn: () => fliqApi<{ items: Institution[] }>(`institutions?country=${country}`),
  });
  const options = institutions.data?.items.filter((item) => item.type === payoutType) ?? [];

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    idempotencyKey.current = null;
  }, [quoteKey, accountKey, clientReference]);

  const requestQuote = useMutation({
    mutationFn: (input: { amount: string; corridor: Corridor }) =>
      fliqApi<Quote>("quotes", {
        method: "POST",
        body: JSON.stringify({
          token: "usdc",
          currency: input.corridor,
          amount: input.amount,
          payout_type: input.corridor === "ngn" ? "bank" : "mobile_money",
        }),
      }),
    onSuccess: (value, input) => {
      const receivedAt = Date.now();
      setNow(receivedAt);
      setQuote({
        value,
        key: `${input.amount}:${input.corridor}`,
        expiresAt: receivedAt + value.expires_in * 1000,
      });
    },
  });
  const verifyAccount = useMutation({
    mutationFn: (input: { bank: string; number: string; country: string; account_name?: string }) =>
      fliqApi<VerifiedAccount>("accounts/verify", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: (value, input) =>
      setVerified({
        value,
        key: `${input.country}:${input.bank}:${input.number}:${input.account_name ?? ""}`,
      }),
  });
  const submitPayout = useMutation({
    mutationFn: (input: { quoteId: string; name: string }) =>
      fliqApi<Payout>("payouts", {
        method: "POST",
        headers: { "Idempotency-Key": (idempotencyKey.current ??= crypto.randomUUID()) },
        body: JSON.stringify({
          quote_id: input.quoteId,
          account: { bank, number: accountNumber },
          account_name: input.name,
          ...(clientReference.trim() ? { client_reference: clientReference.trim() } : {}),
        }),
      }),
    onSuccess: () => {
      idempotencyKey.current = null;
      queryClient.invalidateQueries({ queryKey: ["payouts"] });
      queryClient.invalidateQueries({ queryKey: ["onboarding"] });
      dialogRef.current?.close();
    },
  });

  const validAmount = /^\d+(?:\.\d{1,6})?$/.test(amount) && Number(amount) > 0;
  const validAccount = Boolean(bank) && /^\d{6,20}$/.test(accountNumber);
  const canSubmit = currentQuote?.provider === "mock" && Boolean(currentAccount) && !submitPayout.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || !currentQuote || !currentAccount) return;
    submitPayout.mutate({ quoteId: currentQuote.quote_id, name: currentAccount.account_name });
  }

  function changeCorridor(value: Corridor) {
    idempotencyKey.current = null;
    setCorridor(value);
    setBank("");
    setAccountNumber("");
    setAccountName("");
  }

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

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
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
            <button
              type="button"
              disabled={!validAmount || requestQuote.isPending}
              onClick={() => requestQuote.mutate({ amount, corridor })}
              className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-semibold disabled:opacity-50"
            >
              {requestQuote.isPending ? "Getting quote…" : "Get quote"}
            </button>
            {requestQuote.isError && (
              <p role="alert" className="text-xs text-red-600">
                {requestQuote.error.message}
              </p>
            )}
            {currentQuote && (
              <div className="rounded-lg bg-zinc-50 p-3 text-xs">
                <p className="font-semibold">
                  Recipient gets{" "}
                  {new Intl.NumberFormat("en-NG", {
                    style: "currency",
                    currency: corridor.toUpperCase(),
                    maximumFractionDigits: 0,
                  }).format(currentQuote.receive)}
                </p>
                <p className="mt-1 text-zinc-500">
                  Provider: {currentQuote.provider} · Rate: {currentQuote.rate.toLocaleString("en-NG")}
                </p>
                <p className="mt-1 text-zinc-500">
                  Expires in {Math.max(0, Math.ceil((quote!.expiresAt - now) / 1000))}s
                </p>
              </div>
            )}
            {quote && !currentQuote && (
              <p className="text-xs text-amber-700">Get a fresh quote before sending.</p>
            )}

            <fieldset>
              <legend className="text-xs font-semibold">Corridor</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <CorridorOption
                  value="ngn"
                  label="🇳🇬 NGN bank"
                  selected={corridor === "ngn"}
                  onChange={changeCorridor}
                />
                <CorridorOption
                  value="kes"
                  label="🇰🇪 KES M-Pesa"
                  selected={corridor === "kes"}
                  onChange={changeCorridor}
                />
              </div>
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold">
                {corridor === "ngn" ? "Bank" : "Provider"}
                <select
                  value={bank}
                  onChange={(event) => setBank(event.target.value)}
                  disabled={institutions.isPending || institutions.isError}
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-200 px-3 font-normal outline-none focus:border-zinc-500"
                >
                  <option value="">Select {corridor === "ngn" ? "bank" : "provider"}</option>
                  {options.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.name}
                    </option>
                  ))}
                </select>
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
            {institutions.isError && (
              <p role="alert" className="text-xs text-red-600">
                {institutions.error.message}
              </p>
            )}
            <label className="block text-xs font-semibold">
              Recipient name
              <input
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
                placeholder="If the bank cannot return a name"
                className="mt-2 h-11 w-full rounded-lg border border-zinc-200 px-3 font-normal outline-none focus:border-zinc-500"
              />
            </label>
            <button
              type="button"
              disabled={!validAccount || verifyAccount.isPending}
              onClick={() =>
                verifyAccount.mutate({
                  bank,
                  number: accountNumber,
                  country,
                  ...(accountName.trim() ? { account_name: accountName.trim() } : {}),
                })
              }
              className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-semibold disabled:opacity-50"
            >
              {verifyAccount.isPending ? "Checking account…" : "Verify account"}
            </button>
            {verifyAccount.isError && (
              <p role="alert" className="text-xs text-red-600">
                {verifyAccount.error.message}
              </p>
            )}
            {currentAccount && (
              <div className="rounded-lg bg-zinc-50 p-3 text-xs">
                <p className="font-semibold">{currentAccount.account_name}</p>
                <p className="mt-1 text-zinc-500">
                  {currentAccount.name_verified
                    ? "Name verified by provider"
                    : "Name supplied by you; provider could not verify it"}
                </p>
              </div>
            )}
            <details className="border-t border-zinc-100 pt-4 text-xs text-zinc-500">
              <summary className="cursor-pointer">Advanced: reference</summary>
              <label className="mt-3 block">
                Client reference (optional)
                <input
                  value={clientReference}
                  onChange={(event) => setClientReference(event.target.value)}
                  className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-zinc-500"
                />
              </label>
            </details>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                The same request, as code
              </p>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-zinc-950 p-4 text-xs leading-5 text-zinc-300">
                {JSON.stringify(
                  {
                    quote_id: currentQuote?.quote_id ?? "<get a quote>",
                    account: { bank, number: accountNumber },
                  },
                  null,
                  2,
                )}
              </pre>
            </div>
          </div>
          <div className="border-t border-zinc-200 p-5">
            {currentQuote && currentQuote.provider !== "mock" && (
              <p className="mb-3 text-xs text-amber-700">
                This quote uses {currentQuote.provider}. Test payouts require the mock provider.
              </p>
            )}
            {submitPayout.isError && (
              <p role="alert" className="mb-3 text-xs text-red-600">
                {submitPayout.error.message}
              </p>
            )}
            {submitPayout.isSuccess && (
              <p role="status" className="mb-3 text-xs text-emerald-700">
                Test payout created. It is now in your payouts list.
              </p>
            )}
            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full rounded-lg bg-zinc-950 px-4 py-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitPayout.isPending ? "Sending test payout…" : "Send test payout"}
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
