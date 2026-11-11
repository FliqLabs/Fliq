"use client";

import Link from "next/link";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  fliqApi,
  type WebhookDeliveries,
  type WebhookEndpoint,
  type WebhookEndpoints,
} from "../../lib/fliq-api";
import { WebhooksDashboard, type WebhookDelivery } from "./webhooks-dashboard";

export function WebhooksData() {
  const queryClient = useQueryClient();
  const endpoints = useQuery({
    queryKey: ["webhook-endpoints"],
    queryFn: () => fliqApi<WebhookEndpoints>("webhook-endpoints"),
  });
  const deliveries = useInfiniteQuery({
    queryKey: ["webhook-deliveries"],
    queryFn: ({ pageParam }) =>
      fliqApi<WebhookDeliveries>(
        `webhook-deliveries${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
  const createEndpoint = useMutation({
    mutationFn: (url: string) =>
      fliqApi<WebhookEndpoint & { secret: string }>("webhook-endpoints", {
        method: "POST",
        body: JSON.stringify({ url }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["webhook-endpoints"] });
      queryClient.invalidateQueries({ queryKey: ["onboarding"] });
    },
  });
  const replayDelivery = useMutation({
    mutationFn: (id: string) =>
      fliqApi<unknown>(`webhook-deliveries/${encodeURIComponent(id)}/replay`, {
        method: "POST",
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["webhook-deliveries"] }),
  });

  if (endpoints.isPending || deliveries.isPending) {
    return <main className="py-16 text-center text-sm text-app-muted">Loading webhooks…</main>;
  }
  const error = endpoints.error ?? deliveries.error;
  if (error instanceof ApiError && error.status === 401) {
    return (
      <main className="py-16 text-center">
        <Link href="/sign-in" className="text-sm font-semibold underline">
          Sign in to view webhooks
        </Link>
      </main>
    );
  }
  if (error instanceof ApiError && error.status === 404) {
    return (
      <main className="py-16 text-center">
        <Link href="/create-workspace" className="text-sm font-semibold underline">
          Create a workspace first
        </Link>
      </main>
    );
  }
  if (error)
    return (
      <main role="alert" className="py-16 text-center text-sm text-app-bad">
        {error.message}
      </main>
    );
  if (!endpoints.data || !deliveries.data) {
    return (
      <main role="alert" className="py-16 text-center text-sm text-app-bad">
        Unexpected webhook response.
      </main>
    );
  }

  const rows: WebhookDelivery[] = deliveries.data.pages.flatMap((page) =>
    page.items.map((item) => ({
      id: item.delivery_id,
      event: item.event_type,
      payoutId: item.payout_id ?? "—",
      status: item.status,
      responseCode: item.response_status,
      attempts: item.attempts,
      createdAt: item.created_at,
    })),
  );

  return (
    <WebhooksDashboard
      deliveries={rows}
      endpoints={endpoints.data.items}
      onCreate={async (url) => (await createEndpoint.mutateAsync(url)).secret}
      onReplay={(id) => replayDelivery.mutateAsync(id).then(() => undefined)}
      hasMore={deliveries.hasNextPage}
      loadingMore={deliveries.isFetchingNextPage}
      onLoadMore={() => deliveries.fetchNextPage()}
    />
  );
}
