"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { ApiError, fliqApi, type User } from "../lib/fliq-api";

type Availability = { name: string; available: boolean; reason: string | null };

export function ClaimNameForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const idempotencyKey = useRef<string | null>(null);
  const label = name.trim().toLowerCase();
  const valid = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(label) && !label.includes("--");

  const account = useQuery({ queryKey: ["me"], queryFn: () => fliqApi<User>("me") });
  const availability = useQuery({
    queryKey: ["name", label],
    queryFn: () => fliqApi<Availability>(`names/${encodeURIComponent(label)}`),
    enabled: valid && account.isSuccess && !account.data.near_account,
  });
  const claim = useMutation({
    mutationFn: () =>
      fliqApi<User>("me/name", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey.current ?? crypto.randomUUID() },
        body: JSON.stringify({ name: label }),
      }),
    onSuccess: (user) => {
      queryClient.setQueryData(["me"], user);
      router.replace("/create-workspace");
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || !availability.data?.available) return;
    idempotencyKey.current ??= crypto.randomUUID();
    claim.mutate();
  }

  if (account.isPending) return <p className="text-sm text-zinc-500">Checking your account…</p>;
  if (account.error instanceof ApiError && account.error.status === 401) {
    return (
      <p className="text-sm">
        Sign in first.{" "}
        <Link href="/sign-in" className="font-semibold underline">
          Go to sign in
        </Link>
      </p>
    );
  }
  if (account.isError)
    return (
      <p role="alert" className="text-sm text-red-600">
        {account.error.message}
      </p>
    );
  if (account.data.near_account) {
    return (
      <p className="text-sm">
        Your name is {account.data.near_account}.{" "}
        <Link href="/create-workspace" className="font-semibold underline">
          Continue to workspace
        </Link>
      </p>
    );
  }

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">Claim your name</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Choose the name for your fliq account. On-chain vault provisioning is still being connected.
      </p>
      <form onSubmit={submit} className="mt-7 flex flex-col">
        <label htmlFor="fliq-name" className="text-xs font-medium">
          Your fliq name
        </label>
        <div className="mt-2 flex min-h-12 items-center rounded-lg border border-zinc-200 px-4 focus-within:border-zinc-600">
          <input
            id="fliq-name"
            autoComplete="username"
            required
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              idempotencyKey.current = null;
            }}
            placeholder="yourname"
            className="min-w-0 flex-1 text-sm outline-none"
          />
          <span className="text-sm text-zinc-500">.fliq.near</span>
        </div>
        {name && !valid && (
          <p className="mt-2 text-xs text-zinc-500">
            Use 3–33 lowercase letters, numbers, or single hyphens. Start and end with a letter or number.
          </p>
        )}
        {availability.isSuccess && (
          <p className={`mt-2 text-xs ${availability.data.available ? "text-emerald-700" : "text-red-600"}`}>
            {availability.data.available
              ? "Name available"
              : `Name ${availability.data.reason ?? "unavailable"}`}
          </p>
        )}
        {availability.isError && (
          <p role="alert" className="mt-2 text-xs text-red-600">
            {availability.error.message}
          </p>
        )}
        <button
          type="submit"
          disabled={!availability.data?.available || claim.isPending}
          className="mt-6 min-h-12 rounded-lg bg-zinc-950 px-5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {claim.isPending ? "Claiming name…" : "Claim name"}
        </button>
        {claim.isError && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {claim.error.message}
          </p>
        )}
      </form>
    </>
  );
}
