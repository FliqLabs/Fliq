"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ApiError, fliqApi, type User } from "../../lib/fliq-api";

type KeyList = {
  items: { key_id: string; environment: "test" | "live"; masked: string; created_at: string }[];
};

export function ApiKeysList() {
  const account = useQuery({ queryKey: ["me"], queryFn: () => fliqApi<User>("me") });
  const keys = useQuery({
    queryKey: ["keys"],
    queryFn: () => fliqApi<KeyList>("keys"),
    enabled: account.isSuccess,
  });

  return (
    <main>
      <h1 className="text-xl font-semibold">API keys</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Active keys for your workspace. Full keys are only shown when created.
      </p>
      {(account.isPending || (account.isSuccess && keys.isPending)) && (
        <p className="mt-8 text-sm text-zinc-500">Loading keys…</p>
      )}
      {((account.error instanceof ApiError && account.error.status === 401) ||
        (keys.error instanceof ApiError && keys.error.status === 401)) && (
        <Link href="/sign-in" className="mt-8 inline-block text-sm font-semibold underline">
          Sign in to view keys
        </Link>
      )}
      {keys.error instanceof ApiError && keys.error.status === 404 && (
        <Link href="/create-workspace" className="mt-8 inline-block text-sm font-semibold underline">
          Create a workspace first
        </Link>
      )}
      {account.isError && !(account.error instanceof ApiError && account.error.status === 401) && (
        <p role="alert" className="mt-8 text-sm text-red-600">
          {account.error.message}
        </p>
      )}
      {keys.isError && !(keys.error instanceof ApiError && [401, 404].includes(keys.error.status)) && (
        <p role="alert" className="mt-8 text-sm text-red-600">
          {keys.error.message}
        </p>
      )}
      {keys.isSuccess && (
        <section
          aria-label="Active API keys"
          className="mt-7 overflow-hidden rounded-xl border border-zinc-200"
        >
          {keys.data.items.length === 0 ? (
            <p className="p-8 text-center text-sm text-zinc-500">No API keys available.</p>
          ) : (
            <div className="divide-y divide-zinc-100">
              {keys.data.items.map((key) => (
                <div
                  key={key.key_id}
                  className="flex flex-wrap items-center justify-between gap-3 p-5 text-sm"
                >
                  <div>
                    <p className="font-mono font-medium">{key.masked}</p>
                    <p className="mt-1 text-xs capitalize text-zinc-500">
                      {key.environment} · Created {new Date(key.created_at).toLocaleDateString("en-NG")}
                    </p>
                  </div>
                  <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold capitalize">
                    {key.environment}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
