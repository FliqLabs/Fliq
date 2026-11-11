"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ApiError, fliqApi, type Usage, type User } from "../../lib/fliq-api";

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
  const usage = useQuery({
    queryKey: ["usage", 7],
    queryFn: () => fliqApi<Usage>("usage?days=7"),
    enabled: account.isSuccess && keys.isSuccess,
  });

  return (
    <main>
      <h1 className="text-xl font-semibold">API keys</h1>
      <p className="mt-1 text-sm text-app-muted">
        Active keys for your workspace. Full keys are only shown when created.
      </p>
      {(account.isPending || (account.isSuccess && keys.isPending)) && (
        <p className="mt-8 text-sm text-app-muted">Loading keys…</p>
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
        <p role="alert" className="mt-8 text-sm text-app-bad">
          {account.error.message}
        </p>
      )}
      {keys.isError && !(keys.error instanceof ApiError && [401, 404].includes(keys.error.status)) && (
        <p role="alert" className="mt-8 text-sm text-app-bad">
          {keys.error.message}
        </p>
      )}
      {keys.isSuccess && (
        <section
          aria-label="Active API keys"
          className="mt-7 overflow-hidden rounded-xl border border-app-line"
        >
          {keys.data.items.length === 0 ? (
            <p className="p-8 text-center text-sm text-app-muted">No API keys available.</p>
          ) : (
            <div className="divide-y divide-app-line">
              {keys.data.items.map((key) => (
                <div
                  key={key.key_id}
                  className="flex flex-wrap items-center justify-between gap-3 p-5 text-sm"
                >
                  <div>
                    <p className="font-mono font-medium">{key.masked}</p>
                    <p className="mt-1 text-xs capitalize text-app-muted">
                      {key.environment} · Created {new Date(key.created_at).toLocaleDateString("en-NG")}
                    </p>
                  </div>
                  <span className="rounded-full bg-app-panel2 px-3 py-1 text-xs font-semibold capitalize">
                    {key.environment}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      {usage.isSuccess && (
        <section aria-label="API usage" className="mt-7 rounded-xl border border-app-line p-5">
          <h2 className="text-sm font-semibold">API usage · last 7 days</h2>
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-app-muted">Requests</dt>
              <dd className="mt-1 font-semibold">{usage.data.totals.requests}</dd>
            </div>
            <div>
<<<<<<< HEAD
              <dt className="text-red-700">Failed</dt>
              <dd className="mt-1 font-semibold text-red-800">{usage.data.totals.failed}</dd>
=======
              <dt className="text-app-bad">Failed</dt>
              <dd className="mt-1 font-semibold text-app-bad">{usage.data.totals.failed}</dd>
>>>>>>> 52b2e07c9f81bc0e97433462c0f73623f3156322
            </div>
            <div>
              <dt className="text-app-muted">Payouts created</dt>
              <dd className="mt-1 font-semibold">{usage.data.totals.payouts_created}</dd>
            </div>
          </dl>
        </section>
      )}
      {usage.isError && (
        <p role="alert" className="mt-4 text-sm text-app-bad">
          {usage.error.message}
        </p>
      )}
    </main>
  );
}
