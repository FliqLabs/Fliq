"use client";

import { useState } from "react";
import type { WebhookEndpoint } from "../../lib/fliq-api";
import { ConfirmActionDialog } from "../components/confirm-action-dialog";

export type WebhookDelivery = {
  id: string;
  event: string;
  payoutId: string;
  status: "delivered" | "failed" | "pending";
  responseCode: number | null;
  attempts: number;
  createdAt: string;
};

type Props = {
  deliveries: WebhookDelivery[];
  endpoints: WebhookEndpoint[];
  onCreate?: (url: string) => Promise<string>;
  onReplay?: (deliveryId: string) => Promise<void>;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
};

export function WebhooksDashboard({
  deliveries,
  endpoints,
  onCreate,
  onReplay,
  hasMore,
  loadingMore,
  onLoadMore,
}: Props) {
  const [search, setSearch] = useState("");
  const [url, setUrl] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createdSecret, setCreatedSecret] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [selectedReplayId, setSelectedReplayId] = useState<string | null>(null);
  const selectedDelivery = deliveries.find((delivery) => delivery.id === selectedReplayId);
  const visibleDeliveries = deliveries.filter((delivery) =>
    [delivery.id, delivery.event, delivery.payoutId].some((value) =>
      value.toLowerCase().includes(search.toLowerCase()),
    ),
  );

  async function replay(deliveryId: string) {
    if (!onReplay) return;
    setPendingId(deliveryId);
    setReplayError(null);
    try {
      await onReplay(deliveryId);
    } catch {
      setReplayError("Replay could not be requested. Try again.");
    } finally {
      setPendingId(null);
    }
  }

  async function createEndpoint(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onCreate) return;
    setCreating(true);
    setCreateError("");
    setCreatedSecret("");
    try {
      setCreatedSecret(await onCreate(url.trim()));
      setUrl("");
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : "Could not add endpoint.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <main>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Webhooks</h1>
          <p className="mt-1 text-sm text-app-muted">Track events sent to your workspace endpoint.</p>
        </div>
      </div>

      <section
        aria-label="Webhook endpoint"
        className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-app-line p-5"
      >
        <div>
          <p className="text-xs font-semibold text-app-muted">Endpoint URL</p>
          {endpoints.length === 0 ? (
            <p className="mt-1 text-sm text-app-muted">No endpoint configured</p>
          ) : (
            endpoints.map((endpoint) => (
              <p key={endpoint.endpoint_id} className="mt-1 break-all text-sm font-medium">
                {endpoint.url} <span className="text-xs font-normal text-app-muted">({endpoint.status})</span>
              </p>
            ))
          )}
        </div>
        <form onSubmit={createEndpoint} className="flex w-full flex-wrap gap-2 sm:w-auto">
          <input
            type="url"
            required
            placeholder="https://your-site.com/webhook"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-app-line px-3 py-2.5 text-xs sm:w-64"
          />
          <button
            type="submit"
            disabled={creating || !onCreate}
            className="rounded-lg border border-app-line px-4 py-2.5 text-xs font-semibold disabled:opacity-50"
          >
            {creating ? "Adding…" : "Add endpoint"}
          </button>
        </form>
      </section>
      {createError && (
        <p role="alert" className="mt-3 text-sm text-app-bad">
          {createError}
        </p>
      )}
      {createdSecret && (
        <div role="status" className="mt-3 rounded-lg border border-app-warn-soft bg-app-warn-soft p-4 text-xs">
          <p className="font-semibold">Save this signing secret now. It is shown only once.</p>
          <p className="mt-2 break-all font-mono">{createdSecret}</p>
        </div>
      )}

      <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Recent deliveries</h2>
          <p className="mt-1 text-xs text-app-muted">Replay a delivery from its row.</p>
        </div>
        <label className="sr-only" htmlFor="webhook-search">
          Search deliveries
        </label>
        <input
          id="webhook-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by event or payout ID"
          className="h-10 w-full max-w-xs rounded-lg border border-app-line px-4 text-sm outline-none placeholder:text-app-dim focus:border-app-accent"
        />
      </div>
      {replayError && (
        <p role="alert" className="mt-4 rounded-lg bg-app-bad-soft p-3 text-sm text-app-bad">
          {replayError}
        </p>
      )}

      <section
        aria-label="Webhook deliveries"
        className="mt-4 overflow-hidden rounded-xl border border-app-line"
      >
        <div className="hidden grid-cols-[2fr_1.4fr_1fr_1fr_1fr_auto] gap-4 border-b border-app-line px-4 py-3 text-[11px] font-semibold uppercase text-app-muted md:grid">
          <span>Event</span>
          <span>Payout</span>
          <span>Status</span>
          <span>Response</span>
          <span>When</span>
          <span>Action</span>
        </div>
        {visibleDeliveries.length === 0 ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center px-5 py-14 text-center">
            <div
              aria-hidden="true"
              className="mb-4 grid size-10 place-items-center rounded-full bg-app-panel2 text-app-muted"
            >
              ↗
            </div>
            <h3 className="text-lg font-semibold">
              {deliveries.length === 0 ? "No webhook deliveries yet" : "No matching deliveries"}
            </h3>
            <p className="mt-2 max-w-sm text-sm text-app-muted">
              {deliveries.length === 0
                ? "Events will appear here after a payout sends a webhook to your endpoint."
                : "Try a different event or payout ID."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-app-line">
            {visibleDeliveries.map((delivery) => (
              <div
                key={delivery.id}
                className="grid gap-2 px-4 py-4 text-sm md:grid-cols-[2fr_1.4fr_1fr_1fr_1fr_auto] md:items-center md:gap-4"
              >
                <div>
                  <p className="font-medium">{delivery.event}</p>
                  <p className="text-xs text-app-muted">{delivery.id}</p>
                </div>
                <span className="truncate text-app-fg2">{delivery.payoutId}</span>
                <span
                  className={`w-fit rounded-full px-2 py-1 text-xs font-semibold capitalize ${delivery.status === "delivered" ? "bg-app-good-soft text-app-good" : delivery.status === "failed" ? "bg-app-bad-soft text-app-bad" : "bg-app-warn-soft text-app-warn"}`}
                >
                  {delivery.status}
                </span>
                <span>{delivery.responseCode ?? "—"}</span>
                <time dateTime={delivery.createdAt} className="text-xs text-app-muted">
                  {new Date(delivery.createdAt).toLocaleString("en-NG")}
                </time>
                <button
                  type="button"
                  disabled={!onReplay || pendingId !== null}
                  onClick={() => setSelectedReplayId(delivery.id)}
                  className="w-fit rounded-lg border border-app-line px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:text-app-dim"
                >
                  {pendingId === delivery.id ? "Replaying…" : "Replay"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      {hasMore && onLoadMore && (
        <button
          type="button"
          disabled={loadingMore}
          onClick={onLoadMore}
          className="mt-4 rounded-lg border border-app-line px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
        >
          {loadingMore ? "Loading…" : "Load more deliveries"}
        </button>
      )}
      <ConfirmActionDialog
        open={selectedReplayId !== null}
        title="Replay this webhook delivery?"
        description={
          <p>
            This sends {selectedDelivery?.event ?? "the event"} again to your endpoint. Your receiver may
            process the event more than once.
          </p>
        }
        confirmLabel="Replay delivery"
        tone="warning"
        onCancel={() => setSelectedReplayId(null)}
        onConfirm={() => {
          if (!selectedReplayId) return;
          const deliveryId = selectedReplayId;
          setSelectedReplayId(null);
          void replay(deliveryId);
        }}
      />
    </main>
  );
}
