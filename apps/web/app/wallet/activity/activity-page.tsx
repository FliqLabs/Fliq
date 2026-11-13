"use client";

import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Icon } from "../../components/app/icons";
import { walletApi, type ActivityFilter, type ActivityItem } from "../../lib/wallet-api";
import { LIVE_MS } from "../../lib/wallet-queries";
import { ActivityAvatar, AmountCell, ReceiptDrawer, StatusChip, activitySub, when } from "../activity-ui";

type Tab = "all" | "sent" | "received" | "agents";

const TABS: { id: Tab; label: string; api: ActivityFilter }[] = [
  { id: "all", label: "All", api: "all" },
  { id: "sent", label: "Sent", api: "all" },
  { id: "received", label: "Received", api: "all" },
  { id: "agents", label: "By agents", api: "agents" },
];

const INCOMING = new Set(["deposit", "transfer_in"]);

export function ActivityPage() {
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<ActivityItem | null>(null);
  const api = TABS.find((item) => item.id === tab)!.api;
  const activity = useInfiniteQuery({
    queryKey: ["activity", api, "pages"],
    queryFn: ({ pageParam }) => walletApi.activity(api, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    refetchInterval: LIVE_MS,
  });
  const needle = query.trim().toLowerCase();
  const items = (activity.data?.pages.flatMap((page) => page.items) ?? []).filter((item) => {
    if (tab === "sent" && INCOMING.has(item.kind)) return false;
    if (tab === "received" && !INCOMING.has(item.kind)) return false;
    if (!needle) return true;
    return [item.party.name, item.party.near_account, item.ref_id, item.token].some((value) => value?.toLowerCase().includes(needle));
  });

  return (
    <div className="page">
      <div className="head">
        <div>
          <h1>Activity</h1>
          <p>Every payout, deposit and agent request, with its receipt.</p>
        </div>
      </div>
      <div className="filters">
        <div className="tabs" role="group" aria-label="Filter">
          {TABS.map((item) => (
            <button type="button" key={item.id} aria-pressed={tab === item.id} onClick={() => setTab(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <label className="search">
          <Icon name="search" size={17} />
          <input id="act-q" placeholder="Search name or reference" value={query} autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>
      <section className="card">
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Status</th>
                <th className="r">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.activity_id}
                  tabIndex={0}
                  onClick={() => setOpen(item)}
                  onKeyDown={(event) => event.key === "Enter" && setOpen(item)}
                >
                  <td className="num muted">{when(item.at)}</td>
                  <td>
                    <div className="cellp">
                      <ActivityAvatar item={item} size="sm" />
                      <div>
                        <b>{item.party.name}</b>
                        <span>{activitySub(item).split(" · ").slice(1).join(" · ") || " "}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <StatusChip item={item} />
                  </td>
                  <td className="r num">
                    <div className="amt-cell">
                      <AmountCell item={item} />
                    </div>
                  </td>
                </tr>
              ))}
              {activity.isSuccess && items.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <div className="empty">{needle ? `Nothing matches "${query}".` : "Nothing here yet."}</div>
                  </td>
                </tr>
              )}
              {activity.isPending && (
                <tr>
                  <td colSpan={4}>
                    <div className="empty">Loading activity</div>
                  </td>
                </tr>
              )}
              {activity.isError && (
                <tr>
                  <td colSpan={4}>
                    <div className="empty">{activity.error.message}</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {activity.hasNextPage && (
        <button type="button" className="btn line" style={{ alignSelf: "center" }} disabled={activity.isFetchingNextPage} onClick={() => activity.fetchNextPage()}>
          {activity.isFetchingNextPage ? "Loading" : "Show older"}
        </button>
      )}
      {open && <ReceiptDrawer item={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
