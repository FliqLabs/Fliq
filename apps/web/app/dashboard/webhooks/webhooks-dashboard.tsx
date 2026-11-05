"use client";

import { useState } from "react";

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
  endpoint: string | null;
  onReplay?: (deliveryId: string) => Promise<void>;
};

export function WebhooksDashboard({ deliveries, endpoint, onReplay }: Props) {
  const [search, setSearch] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);
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

  return (
    <main>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Webhooks</h1>
          <p className="mt-1 text-sm text-zinc-500">Track events sent to your workspace endpoint.</p>
        </div>
      </div>

      <section
        aria-label="Webhook endpoint"
        className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-zinc-200 p-5"
      >
        <div>
          <p className="text-xs font-semibold text-zinc-500">Endpoint URL</p>
          <p className="mt-1 break-all text-sm font-medium">{endpoint ?? "No endpoint configured"}</p>
          {!endpoint && (
            <p className="mt-1 text-xs text-zinc-500">
              Endpoint setup will be available when workspace settings are connected.
            </p>
          )}
        </div>
        <button
          type="button"
          disabled
          className="rounded-lg border border-zinc-200 px-4 py-2.5 text-xs font-semibold text-zinc-400"
        >
          Add endpoint
        </button>
      </section>

      <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Recent deliveries</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Replay a delivery from its row when the webhook API is connected.
          </p>
        </div>
        <label className="sr-only" htmlFor="webhook-search">
          Search deliveries
        </label>
        <input
          id="webhook-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by event or payout ID"
          className="h-10 w-full max-w-xs rounded-lg border border-zinc-200 px-4 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500"
        />
      </div>
      {replayError && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {replayError}
        </p>
      )}

      <section
        aria-label="Webhook deliveries"
        className="mt-4 overflow-hidden rounded-xl border border-zinc-200"
      >
        <div className="hidden grid-cols-[2fr_1.4fr_1fr_1fr_1fr_auto] gap-4 border-b border-zinc-200 px-4 py-3 text-[11px] font-semibold uppercase text-zinc-500 md:grid">
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
              className="mb-4 grid size-10 place-items-center rounded-full bg-zinc-100 text-zinc-500"
            >
              ↗
            </div>
            <h3 className="text-lg font-semibold">
              {deliveries.length === 0 ? "No webhook deliveries yet" : "No matching deliveries"}
            </h3>
            <p className="mt-2 max-w-sm text-sm text-zinc-500">
              {deliveries.length === 0
                ? "Events will appear here after a payout sends a webhook to your endpoint."
                : "Try a different event or payout ID."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {visibleDeliveries.map((delivery) => (
              <div
                key={delivery.id}
                className="grid gap-2 px-4 py-4 text-sm md:grid-cols-[2fr_1.4fr_1fr_1fr_1fr_auto] md:items-center md:gap-4"
              >
                <div>
                  <p className="font-medium">{delivery.event}</p>
                  <p className="text-xs text-zinc-500">{delivery.id}</p>
                </div>
                <span className="truncate text-zinc-600">{delivery.payoutId}</span>
                <span
                  className={`w-fit rounded-full px-2 py-1 text-xs font-semibold capitalize ${delivery.status === "delivered" ? "bg-emerald-50 text-emerald-700" : delivery.status === "failed" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}
                >
                  {delivery.status}
                </span>
                <span>{delivery.responseCode ?? "—"}</span>
                <time dateTime={delivery.createdAt} className="text-xs text-zinc-500">
                  {new Date(delivery.createdAt).toLocaleString("en-NG")}
                </time>
                <button
                  type="button"
                  disabled={!onReplay || pendingId !== null}
                  onClick={() => replay(delivery.id)}
                  className="w-fit rounded-lg border border-zinc-200 px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:text-zinc-400"
                >
                  {pendingId === delivery.id ? "Replaying…" : "Replay"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
