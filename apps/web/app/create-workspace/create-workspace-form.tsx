"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { ApiError, fliqApi, type User, type Workspace, type WorkspaceCreated } from "../lib/fliq-api";

const productTypes = [
  { label: "Wallet", value: "wallet" },
  { label: "Payroll", value: "payroll" },
  { label: "Marketplace", value: "marketplace" },
  { label: "Agent", value: "agent" },
  { label: "Other", value: "other" },
] as const;
const payoutCountries = [
  { label: "Nigeria", value: "ng" },
  { label: "Kenya", value: "ke" },
  { label: "Ghana", value: "gh" },
  { label: "Indonesia", value: "id" },
  { label: "Philippines", value: "ph" },
] as const;

type UseCase = (typeof productTypes)[number]["value"];

export function CreateWorkspaceForm() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [useCase, setUseCase] = useState<UseCase | null>(null);
  const [countries, setCountries] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const idempotencyKey = useRef<string | null>(null);

  const account = useQuery({ queryKey: ["me"], queryFn: () => fliqApi<User>("me") });
  const existing = useQuery({
    queryKey: ["workspace"],
    queryFn: () => fliqApi<Workspace>("workspaces/current"),
    enabled: account.isSuccess && Boolean(account.data.near_account),
  });
  const create = useMutation({
    mutationFn: () =>
      fliqApi<WorkspaceCreated>("workspaces", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey.current ?? crypto.randomUUID() },
        body: JSON.stringify({ name: name.trim(), use_case: useCase, countries }),
      }),
    onSuccess: ({ workspace }) => queryClient.setQueryData(["workspace"], workspace),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !useCase || countries.length === 0) return;
    idempotencyKey.current ??= crypto.randomUUID();
    create.mutate();
  }

  function toggleCountry(value: string) {
    idempotencyKey.current = null;
    setCountries((current) =>
      current.includes(value) ? current.filter((country) => country !== value) : [...current, value],
    );
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
  if (!account.data.near_account) {
    return (
      <p className="text-sm">
        Claim your fliq name first.{" "}
        <Link href="/claim-name" className="font-semibold underline">
          Claim a name
        </Link>
      </p>
    );
  }
  if (create.isSuccess) {
    return (
      <section aria-label="Workspace created">
        <h1 className="text-3xl font-bold">Workspace created</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Your sandbox key is shown once. Copy it and keep it somewhere safe.
        </p>
        <div className="mt-6 break-all rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-mono text-sm">
          {create.data.sandbox_key.key}
        </div>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(create.data.sandbox_key.key);
            setCopied(true);
          }}
          className="mt-3 rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold"
        >
          {copied ? "Copied" : "Copy key"}
        </button>
        <Link
          href="/dashboard"
          className="mt-6 block rounded-lg bg-zinc-950 px-5 py-3 text-center text-sm font-semibold text-white"
        >
          Continue to dashboard
        </Link>
      </section>
    );
  }

  if (existing.isPending) return <p className="text-sm text-zinc-500">Checking your workspace…</p>;
  if (existing.isSuccess) {
    return (
      <p className="text-sm">
        Your workspace, {existing.data.name}, is ready.{" "}
        <Link href="/dashboard" className="font-semibold underline">
          Open dashboard
        </Link>
      </p>
    );
  }
  if (existing.isError && (!(existing.error instanceof ApiError) || existing.error.status !== 404)) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {existing.error.message}
      </p>
    );
  }

  return (
    <>
      <p className="mb-5 text-xs font-semibold text-zinc-500">
        1 Workspace &nbsp; · &nbsp; 2 Sandbox key &nbsp; · &nbsp; 3 First payout
      </p>
      <h1 className="text-3xl font-bold tracking-tight">Name your workspace</h1>
      <p className="mt-1 text-sm text-zinc-500">You can rename it later. The key comes next.</p>
      <form onSubmit={submit} className="mt-7 flex flex-col">
        <label htmlFor="workspace-name" className="text-xs font-medium">
          Workspace
        </label>
        <input
          id="workspace-name"
          type="text"
          autoComplete="organization"
          required
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            idempotencyKey.current = null;
          }}
          placeholder="Your workspace name"
          className="mt-1.5 min-h-12 rounded-lg border border-zinc-200 px-4 text-sm outline-none focus:border-zinc-600"
        />
        <fieldset className="mt-6">
          <legend className="mb-2 text-xs font-medium">What are you building?</legend>
          <div className="flex flex-wrap gap-2">
            {productTypes.map((type) => (
              <label key={type.value} className="cursor-pointer">
                <input
                  type="radio"
                  name="product-type"
                  value={type.value}
                  checked={useCase === type.value}
                  onChange={() => {
                    setUseCase(type.value);
                    idempotencyKey.current = null;
                  }}
                  className="peer sr-only"
                />
                <span className="inline-flex rounded-full border border-zinc-200 px-3 py-1.5 text-xs peer-checked:border-zinc-950 peer-checked:bg-zinc-950 peer-checked:text-white">
                  {type.label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="mt-6">
          <legend className="mb-2 text-xs font-medium">Where do you pay out?</legend>
          <div className="flex flex-wrap gap-2">
            {payoutCountries.map((country) => (
              <label key={country.value} className="cursor-pointer">
                <input
                  type="checkbox"
                  name="payout-country"
                  value={country.value}
                  checked={countries.includes(country.value)}
                  onChange={() => toggleCountry(country.value)}
                  className="peer sr-only"
                />
                <span className="inline-flex rounded-full border border-zinc-200 px-3 py-1.5 text-xs peer-checked:border-zinc-950 peer-checked:bg-zinc-950 peer-checked:text-white">
                  {country.label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <button
          type="submit"
          disabled={create.isPending || !useCase || countries.length === 0}
          className="mt-8 min-h-12 rounded-lg bg-zinc-950 px-5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {create.isPending ? "Creating workspace…" : "Create workspace and sandbox key"}
        </button>
        {create.isError && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {create.error.message}
          </p>
        )}
      </form>
    </>
  );
}
