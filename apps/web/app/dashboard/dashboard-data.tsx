"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ApiError,
  fliqApi,
  type Onboarding,
  type PayoutList,
  type PayoutStats,
  type User,
  type Workspace,
} from "../lib/fliq-api";
import { PayoutsDashboard, type DashboardSummary, type PayoutRow } from "./payouts-dashboard";

export function DashboardData() {
  const account = useQuery({ queryKey: ["me"], queryFn: () => fliqApi<User>("me") });
  const workspace = useQuery({
    queryKey: ["workspace"],
    queryFn: () => fliqApi<Workspace>("workspaces/current"),
    enabled: account.isSuccess && Boolean(account.data.near_account),
  });
  const payouts = useInfiniteQuery({
    queryKey: ["payouts", workspace.data?.workspace_id],
    queryFn: ({ pageParam }) =>
      fliqApi<PayoutList>(`payouts${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: workspace.isSuccess,
  });
  const onboarding = useQuery({
    queryKey: ["onboarding", workspace.data?.workspace_id],
    queryFn: () => fliqApi<Onboarding>("onboarding"),
    enabled: workspace.isSuccess && payouts.isSuccess,
  });
  const stats = useQuery({
    queryKey: ["payout-stats", workspace.data?.workspace_id],
    queryFn: () =>
      fliqApi<PayoutStats>(
        `payouts/stats?tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`,
      ),
    enabled: workspace.isSuccess,
  });
  if (account.isPending) return <Status message="Checking your session…" />;
  if (account.error instanceof ApiError && account.error.status === 401) {
    return <Status message="Sign in to see your payouts." href="/sign-in" action="Sign in" />;
  }
  if (account.isError) return <Status message={account.error.message} />;
  if (!account.data.near_account) {
    return <Status message="Claim your fliq name to continue." href="/claim-name" action="Claim name" />;
  }
  if (workspace.isPending) return <Status message="Loading your workspace…" />;
  if (workspace.error instanceof ApiError && workspace.error.status === 404) {
    return (
      <Status
        message="Create your workspace to start testing payouts."
        href="/create-workspace"
        action="Create workspace"
      />
    );
  }
  if (workspace.isError) return <Status message={workspace.error.message} />;
  if (payouts.isPending) return <Status message="Loading payouts…" />;
  if (payouts.isError) return <Status message={payouts.error.message} />;

  const rows: PayoutRow[] = payouts.data.pages.flatMap((page) =>
    page.items.map((item) => ({
      id: item.payout_id,
      recipient: item.account_name,
      destination: `${item.bank.name} ···· ${item.account_last4}`,
      amount: item.receive,
      currency: item.currency,
      provider: item.provider,
      state: item.state,
      when: new Date(item.created_at).toLocaleDateString("en-NG"),
    })),
  );
  const summary: DashboardSummary = {
    settledToday: stats.data?.settled.count ?? null,
    medianSecondsToBank: stats.data?.median_seconds_to_bank ?? null,
    refusedByVaultCaps: stats.data?.refused.count ?? null,
  };

  return (
    <PayoutsDashboard
      summary={summary}
      summaryLoading={stats.isPending}
      summaryError={stats.error?.message}
      payouts={rows}
      onboarding={onboarding.data}
      hasMore={payouts.hasNextPage}
      loadingMore={payouts.isFetchingNextPage}
      onLoadMore={() => payouts.fetchNextPage()}
    />
  );
}

function Status({ message, href, action }: { message: string; href?: string; action?: string }) {
  return (
    <main className="mx-auto max-w-lg py-16 text-center">
      <p className="text-sm text-app-muted">{message}</p>
      {href && action && (
        <Link
          href={href}
          className="mt-5 inline-flex rounded-lg bg-app-ink px-4 py-2.5 text-sm font-semibold text-app-ink-fg"
        >
          {action}
        </Link>
      )}
    </main>
  );
}
