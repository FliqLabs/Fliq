"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ApiError, fliqApi, type AgentList, type Money } from "../lib/fliq-api";

function money(value: Money) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: value.currency,
    maximumFractionDigits: 2,
  }).format(Number(value.amount));
}

export function AgentsLive() {
  const agents = useQuery({
    queryKey: ["agents"],
    queryFn: () => fliqApi<AgentList>("agents"),
  });

  return (
    <div className="relative mx-auto w-full max-w-[510px]">
      <div className="absolute -inset-5 rounded-[32px] bg-brand/5 blur-3xl" />
      <div className="relative overflow-hidden rounded-[22px] border border-[#303030] bg-[#111] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#292929] px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-white">Your agents</p>
            <p className="mt-1 text-xs text-zinc-500">Live workspace data</p>
          </div>
          <span className="rounded-full border border-[#383838] px-3 py-1 text-xs text-zinc-400">
            {agents.isSuccess ? `${agents.data.agents.length} connected` : "Fliq"}
          </span>
        </div>

        <div className="space-y-3 p-5">
          {agents.isPending && (
            <p className="py-12 text-center text-sm text-zinc-500">Loading your agents…</p>
          )}

          {agents.isError && (
            <div className="py-10 text-center">
              <p className="text-sm text-zinc-300">
                {agents.error instanceof ApiError && agents.error.status === 401
                  ? "Sign in to view your agents."
                  : agents.error.message}
              </p>
              {agents.error instanceof ApiError && agents.error.status === 401 && (
                <Link href="/sign-in" className="mt-4 inline-block rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black">
                  Sign in
                </Link>
              )}
              <button onClick={() => agents.refetch()} className="mt-4 block w-full text-xs text-zinc-500 hover:text-white">
                Try again
              </button>
            </div>
          )}

          {agents.isSuccess && agents.data.agents.length === 0 && (
            <div className="py-12 text-center">
              <p className="text-sm font-medium text-white">No agents connected yet</p>
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                Connected agents will appear here with their actual spending limits and status.
              </p>
            </div>
          )}

          {agents.data?.agents.map((agent) => {
            const spent = Number(agent.spent_today.amount);
            const cap = Number(agent.daily_cap.amount);
            const progress = agent.spent_today.currency === agent.daily_cap.currency && cap > 0
              ? Math.min(100, Math.max(0, (spent / cap) * 100))
              : 0;

            return (
              <article key={agent.agent_id} className="rounded-2xl border border-[#303030] bg-[#181818] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-white">{agent.name}</p>
                    <p className="mt-1 break-all text-xs text-zinc-500">{agent.agent_id}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] capitalize ${
                    agent.state === "active" ? "bg-emerald-950/50 text-emerald-400" :
                    agent.state === "pending" ? "bg-amber-950/50 text-amber-400" :
                    "bg-zinc-800 text-zinc-400"
                  }`}>
                    {agent.state}
                  </span>
                </div>

                <div className="mt-5 rounded-xl border border-[#303030] bg-[#111] p-4">
                  <div className="flex items-end justify-between gap-2">
                    <div>
                      <p className="text-xs text-zinc-500">Spent today</p>
                      <p className="mt-1 text-2xl font-semibold text-white">{money(agent.spent_today)}</p>
                    </div>
                    <p className="text-right text-xs text-zinc-500">of {money(agent.daily_cap)}</p>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#303030]">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${progress}%` }} />
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-[#303030] p-3">
                    <p className="text-xs text-zinc-500">Per payout</p>
                    <p className="mt-1 text-sm font-semibold text-white">{money(agent.per_payout_cap)}</p>
                  </div>
                  <div className="rounded-xl border border-[#303030] p-3">
                    <p className="text-xs text-zinc-500">Currencies</p>
                    <p className="mt-1 text-sm font-semibold text-white">{agent.currencies.join(" · ")}</p>
                  </div>
                </div>

                <p className="mt-3 text-xs text-zinc-500">
                  {agent.saved_accounts_only ? "Saved accounts only" : "Any verified account"}
                  {" · "}Expires {new Date(agent.expires_at).toLocaleDateString("en-NG")}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
