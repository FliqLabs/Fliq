"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ApiError, fliqApi, type User } from "../../lib/fliq-api";

export function ProfileForm() {
  const queryClient = useQueryClient();
  const account = useQuery({ queryKey: ["me"], queryFn: () => fliqApi<User>("me") });
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [occupation, setOccupation] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: () =>
      fliqApi<User>("me", {
        method: "PATCH",
        body: JSON.stringify({
          display_name: (displayName ?? account.data?.display_name ?? "").trim(),
          occupation: (occupation ?? account.data?.occupation ?? "").trim() || null,
        }),
      }),
    onSuccess: (user) => queryClient.setQueryData(["me"], user),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    update.mutate();
  }

  if (account.isPending) return <p className="text-sm text-zinc-500">Loading profile…</p>;
  if (account.error instanceof ApiError && account.error.status === 401)
    return (
      <Link href="/sign-in" className="text-sm font-semibold underline">
        Sign in to view your profile
      </Link>
    );
  if (account.isError)
    return (
      <p role="alert" className="text-sm text-red-600">
        {account.error.message}
      </p>
    );

  return (
    <main className="max-w-xl">
      <h1 className="text-xl font-semibold">Profile</h1>
      <p className="mt-1 text-sm text-zinc-500">Your fliq account details.</p>
      <form onSubmit={submit} className="mt-7 flex flex-col gap-5 rounded-xl border border-zinc-200 p-6">
        <label className="text-xs font-semibold">
          Fliq name
          <input
            readOnly
            value={account.data.near_account ?? "Not claimed"}
            className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm font-normal"
          />
        </label>
        {account.data.near_account && (
          <Link href="/claim-name" className="text-sm font-semibold underline">
            Check or restore your NEAR signing key
          </Link>
        )}
        <label className="text-xs font-semibold">
          Display name
          <input
            value={displayName ?? account.data.display_name ?? ""}
            onChange={(event) => setDisplayName(event.target.value)}
            className="mt-2 h-11 w-full rounded-lg border border-zinc-200 px-3 text-sm font-normal outline-none focus:border-zinc-500"
          />
        </label>
        <label className="text-xs font-semibold">
          What you do
          <input
            value={occupation ?? account.data.occupation ?? ""}
            onChange={(event) => setOccupation(event.target.value)}
            className="mt-2 h-11 w-full rounded-lg border border-zinc-200 px-3 text-sm font-normal outline-none focus:border-zinc-500"
          />
        </label>
        <button
          type="submit"
          disabled={update.isPending}
          className="w-fit rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {update.isPending ? "Saving…" : "Save profile"}
        </button>
        {update.isSuccess && (
          <p role="status" className="text-sm text-emerald-700">
            Profile saved.
          </p>
        )}
        {update.isError && (
          <p role="alert" className="text-sm text-red-600">
            {update.error.message}
          </p>
        )}
      </form>
    </main>
  );
}
