"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Notice, PageState } from "../../../components/app/ui";
import { formatUsd } from "../../../lib/money";
import { walletApi, type DailyLimits } from "../../../lib/wallet-api";
import { keys, useDailyLimits } from "../../../lib/wallet-queries";

function cents(value: string): bigint | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function effectiveDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function DailyLimitPage() {
  const limits = useDailyLimits();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const current = limits.data;
  const entered = cents(amount.trim());
  const currentCents = current?.daily_limit ? cents(current.daily_limit) : null;
  const validAmount = entered !== null && entered > 0n;
  const isRaise = validAmount && currentCents !== null && entered > currentCents;
  const isSame = validAmount && currentCents === entered;

  const save = useMutation({
    mutationFn: walletApi.updateLimits,
    onSuccess: (updated: DailyLimits) => {
      queryClient.setQueryData(keys.limits, updated);
      setEditing(false);
      setConfirmRemove(false);
      setAmount("");
    },
  });
  const cancel = useMutation({
    mutationFn: walletApi.cancelPendingLimit,
    onSuccess: (updated: DailyLimits) => queryClient.setQueryData(keys.limits, updated),
  });

  if (limits.isPending) return <PageState message="Loading your daily limit" />;
  if (limits.isError) {
    return (
      <PageState
        message={limits.error.message}
        action={
          <button type="button" className="btn line" onClick={() => limits.refetch()}>
            Try again
          </button>
        }
      />
    );
  }
  if (!current) return null;

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="head">
        <div>
          <Link className="link" href="/wallet/account">
            ← Account
          </Link>
          <h1>Daily limit</h1>
          <p>Control how much can leave your account in a rolling 24 hours.</p>
        </div>
      </div>

      <section className="card pad stack">
        <div>
          <span className="muted">Most that can leave in 24 hours</span>
          <div className="big num" style={{ fontSize: "clamp(36px, 7vw, 54px)", marginTop: 8 }}>
            {current.daily_limit === null ? "No daily limit" : formatUsd(current.daily_limit)}
          </div>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <span>
            Used: <strong>{formatUsd(current.spent_today)}</strong>
          </span>
          {current.remaining !== null && (
            <span>
              Left for the next 24 hours: <strong>{formatUsd(current.remaining)}</strong>
            </span>
          )}
        </div>
      </section>

      {current.pending && (
        <section className="card pad stack" aria-live="polite">
          <div>
            <h2>
              {current.pending.daily_limit === null
                ? `Your limit will be removed on ${effectiveDate(current.pending.effective_at)}`
                : `Going up to ${formatUsd(current.pending.daily_limit)} on ${effectiveDate(current.pending.effective_at)}`}
            </h2>
            <p className="muted">
              Your current limit stays in place until then. We send a warning to your phone.
            </p>
          </div>
          <button
            type="button"
            className="btn danger"
            style={{ alignSelf: "flex-start" }}
            disabled={cancel.isPending || save.isPending}
            onClick={() => cancel.mutate()}
          >
            {cancel.isPending ? "Cancelling…" : "Cancel this change"}
          </button>
          {cancel.isError && <Notice tone="bad">{cancel.error.message}</Notice>}
        </section>
      )}

      <section className="card pad stack">
        <h2>Change your limit</h2>
        {editing ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (entered !== null && entered > 0n && !isSame) {
                const dollars = entered / 100n;
                const fraction = (entered % 100n).toString().padStart(2, "0");
                save.mutate(`${dollars}.${fraction}`);
              }
            }}
            className="stack"
          >
            <label htmlFor="daily-limit-amount">Daily limit in US dollars</label>
            <input
              id="daily-limit-amount"
              className="inp"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="500.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-invalid={amount.length > 0 && !validAmount}
            />
            {amount.length > 0 && !validAmount && (
              <span role="alert" className="err">
                Enter an amount above $0 with up to two decimals.
              </span>
            )}
            {isRaise && (
              <Notice tone="warn">
                A higher limit takes effect after 24 hours. Your current limit stays in place until then.
              </Notice>
            )}
            {validAmount && !isRaise && !isSame && (
              <Notice>Setting or lowering a limit applies at once.</Notice>
            )}
            <div className="row2">
              <button
                type="button"
                className="btn line"
                onClick={() => {
                  setEditing(false);
                  setAmount("");
                  save.reset();
                }}
              >
                Cancel
              </button>
              <button type="submit" className="btn ink" disabled={!validAmount || isSame || save.isPending || cancel.isPending}>
                {save.isPending ? "Saving…" : "Save limit"}
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="btn ink"
            style={{ alignSelf: "flex-start" }}
            onClick={() => setEditing(true)}
          >
            {current.daily_limit === null ? "Set a limit" : "Change limit"}
          </button>
        )}
        {current.daily_limit !== null &&
          !current.pending &&
          (confirmRemove ? (
            <div className="stack">
              <Notice tone="warn">
                Removing your limit takes effect after 24 hours. Your current limit stays in place until then.
              </Notice>
              <div className="row2">
                <button type="button" className="btn line" onClick={() => setConfirmRemove(false)}>
                  Keep limit
                </button>
                <button
                  type="button"
                  className="btn danger"
                  disabled={save.isPending || cancel.isPending}
                  onClick={() => save.mutate(null)}
                >
                  Confirm removal
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn danger"
              style={{ alignSelf: "flex-start" }}
              onClick={() => setConfirmRemove(true)}
            >
              Remove limit
            </button>
          ))}
        {save.isError && <Notice tone="bad">{save.error.message}</Notice>}
      </section>

      <section className="card pad stack">
        <h2>How it works</h2>
        <p className="muted">
          The limit covers cash-outs, payments to people on fliq, and sends to outside wallets. Setting or
          lowering it applies at once. Raising or removing it takes 24 hours.
        </p>
      </section>
    </div>
  );
}
