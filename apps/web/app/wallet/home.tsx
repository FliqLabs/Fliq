"use client";

/* eslint-disable @next/next/no-img-element -- flags and logos are tiny fixed images */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "../components/app/icons";
import { Avatar, BigMoney, Chip, IconBubble, PageState } from "../components/app/ui";
import { CORRIDORS } from "../lib/corridors";
import { bankLogo, providerName } from "../lib/assets";
import {
  CURRENCIES,
  formatMoney,
  formatRate,
  isLocalCurrency,
  toCurrency,
  type LocalCurrency,
} from "../lib/money";
import { explorerAccountUrl } from "../lib/near-explorer";
import type { ActivityItem, RateBoard } from "../lib/wallet-api";
import {
  useActivity,
  useAgents,
  useMe,
  useRateBoard,
  useRecentPeople,
  useRecipients,
  useVault,
} from "../lib/wallet-queries";
import { ActivityAvatar, ActivityRow, LoadingRows, ReceiptDrawer, when } from "./activity-ui";

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export function bestRoute(board: RateBoard | undefined) {
  if (!board) return null;
  return board.providers.find((provider) => provider.provider === board.best && provider.rate) ?? null;
}

function useSecondsSince(at: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return at ? Math.max(0, Math.round((now - new Date(at).getTime()) / 1000)) : null;
}

function Balance({ home }: { home: LocalCurrency }) {
  const vault = useVault();
  const board = useRateBoard(home);
  const [hidden, setHidden] = useState(false);
  const best = bestRoute(board.data);
  const available = vault.data ? Number(vault.data.available) : null;
  const compared = board.data?.providers.length ?? 0;

  return (
    <section className="card bal" aria-label="Balance">
      <div className="bal-top">
        <div className="bal-l">
          Vault balance
          <button
            type="button"
            className="iconbtn"
            onClick={() => setHidden((value) => !value)}
            aria-label={hidden ? "Show balance" : "Hide balance"}
            style={{ width: 30, height: 30 }}
          >
            <Icon name={hidden ? "eyeOff" : "eye"} size={17} />
          </button>
        </div>
        {best?.rate && (
          <span className="ratepill">
            <img src={CURRENCIES[home].flag} alt="" />
            $1 = {formatRate(best.rate, home)} · best of {compared}
          </span>
        )}
      </div>
      <div>
        <div className="big">
          {hidden ? (
            <>
              <span className="cs">$</span>••••
            </>
          ) : available == null ? (
            <span className="muted">···</span>
          ) : (
            <BigMoney value={available} currency="USD" />
          )}
        </div>
        <div className="muted num" style={{ marginTop: 10 }}>
          {hidden
            ? "Hidden"
            : vault.isError
              ? vault.error.message
              : available != null && best?.rate
                ? `About ${formatMoney(Math.floor(available * best.rate), home)} if you cash out all of it now`
                : vault.data && Number(vault.data.reserved) > 0
                  ? `${formatMoney(vault.data.reserved, "USD")} is on its way out`
                  : " "}
        </div>
      </div>
      <div className="acts3">
        <Link className="btn ink lg" href="/wallet/send">
          <Icon name="send" size={18} />
          Send
        </Link>
        <Link className="btn line lg" href="/wallet/add">
          <Icon name="plus" size={18} />
          Add money
        </Link>
        <Link className="btn line lg" href="/wallet/add#request">
          <Icon name="link" size={18} />
          Request
        </Link>
      </div>
    </section>
  );
}

function LivePayout({ item }: { item: ActivityItem }) {
  const seconds = useSecondsSince(item.at) ?? 0;
  return (
    <Link className="live" href={`/wallet/payouts/${encodeURIComponent(item.ref_id)}`}>
      <ActivityAvatar item={item} />
      <div className="t">
        <b className="num">
          {item.local ? formatMoney(item.local.amount, toCurrency(item.local.currency)) : `$${item.usd}`} to{" "}
          {item.party.name}
        </b>
        <span>
          {item.provider ? `${providerName(item.provider)} is paying` : "Moving"} · {Math.floor(seconds / 60)}
          :{String(seconds % 60).padStart(2, "0")}
        </span>
        <div className="bar" style={{ marginTop: 8 }}>
          <i style={{ width: `${Math.min(92, 20 + seconds * 3)}%` }} />
        </div>
      </div>
      <Icon name="chevR" size={18} />
    </Link>
  );
}

function SendAgain() {
  const recipients = useRecipients();
  const people = useRecentPeople();
  const items = [
    ...(recipients.data?.items ?? []).map((recipient) => ({
      key: recipient.recipient_id,
      href: `/wallet/send?to=${encodeURIComponent(recipient.recipient_id)}`,
      name: recipient.account_name,
      label: recipient.own ? "Me" : recipient.account_name.split(" ")[0],
      badge: bankLogo(recipient.bank.logo_key, recipient.bank.code, recipient.bank.name),
      photo: null as string | null,
    })),
    ...(people.data?.items ?? []).map((person) => ({
      key: person.near_account,
      href: `/wallet/send?person=${encodeURIComponent(person.near_account)}`,
      name: person.display_name ?? person.near_account,
      label: person.display_name ?? person.near_account.split(".")[0],
      badge: "/landing/tokens/near.webp",
      photo: person.photo_url,
    })),
  ];
  return (
    <section className="card">
      <div className="card-h">
        <h2>Send again</h2>
        <Link href="/wallet/recipients">All recipients</Link>
      </div>
      <div style={{ display: "flex", gap: 18, padding: "16px 20px 18px", overflowX: "auto" }}>
        {items.map((item) => (
          <Link key={item.key} href={item.href} className="pick-person">
            <Avatar name={item.name} photo={item.photo} badge={item.badge} />
            <span>{item.label}</span>
          </Link>
        ))}
        <Link href="/wallet/recipients?add=1" className="pick-person">
          <span className="av">
            <span className="ph" style={{ border: "1.5px dashed var(--line2)", background: "none" }}>
              <Icon name="plus" size={18} />
            </span>
          </span>
          <span style={{ color: "var(--muted)" }}>New</span>
        </Link>
      </div>
    </section>
  );
}

function RecentActivity() {
  const activity = useActivity();
  const [open, setOpen] = useState<ActivityItem | null>(null);
  return (
    <section className="card">
      <div className="card-h">
        <h2>Recent activity</h2>
        <Link href="/wallet/activity">See all</Link>
      </div>
      <div className="rows">
        {activity.isPending && <LoadingRows />}
        {activity.isError && <div className="empty">{activity.error.message}</div>}
        {activity.data?.items.length === 0 && (
          <div className="empty">Nothing yet. Add money to get started.</div>
        )}
        {activity.data?.items
          .slice(0, 5)
          .map((item) => <ActivityRow key={item.activity_id} item={item} onOpen={setOpen} />)}
      </div>
      {open && <ReceiptDrawer item={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function RateRow({ code }: { code: string }) {
  const corridor = CORRIDORS.find((item) => item.code === code)!;
  const board = useRateBoard(code, corridor.live);
  const best = bestRoute(board.data);
  const currency = corridor.currency.toUpperCase();
  return (
    <div className="rate-row">
      <img
        src={
          isLocalCurrency(currency)
            ? CURRENCIES[currency].flag
            : `/landing/icons/flags/${corridor.code.slice(0, 2)}.svg`
        }
        alt=""
      />
      <div className="t">
        <b>{corridor.currency}</b>
        <span>{corridor.country}</span>
      </div>
      <div className="v">
        {best?.rate && isLocalCurrency(currency) ? (
          <>
            {formatRate(best.rate, currency)}
            <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>
              {providerName(best.provider)}
            </span>
          </>
        ) : corridor.live && board.isPending ? (
          <span className="muted">···</span>
        ) : (
          <Chip>Soon</Chip>
        )}
      </div>
    </div>
  );
}

function Rates() {
  const board = useRateBoard("ngn");
  const age = useSecondsSince(board.data?.fetched_at);
  return (
    <section className="card">
      <div className="card-h">
        <h2>Best rates now</h2>
        <span className="muted" style={{ fontSize: 12 }}>
          {age == null ? "" : `updated ${age < 90 ? `${age}s` : `${Math.round(age / 60)} min`} ago`}
        </span>
      </div>
      <div style={{ padding: "8px 0 4px" }}>
        {CORRIDORS.map((corridor) => (
          <RateRow key={corridor.code} code={corridor.code} />
        ))}
      </div>
      <div className="foot">
        <span>Per $1, after every fee</span>
        <Link className="link" href="/wallet/send">
          Send now
        </Link>
      </div>
    </section>
  );
}

function AgentsToday() {
  const agents = useAgents();
  const active = agents.data?.agents.filter((agent) => agent.state !== "revoked") ?? [];
  return (
    <section className="card">
      <div className="card-h">
        <h2>Agents today</h2>
        <Link href="/wallet/agents">Manage</Link>
      </div>
      <div style={{ padding: "6px 0 10px" }}>
        {agents.isPending && <LoadingRows />}
        {agents.isSuccess && active.length === 0 && <div className="empty">No agents connected.</div>}
        {active.map((agent) => {
          const currency = toCurrency(agent.daily_cap.currency);
          const spent = Number(agent.spent_today.amount);
          const cap = Number(agent.daily_cap.amount);
          return (
            <div key={agent.agent_id} className="agent-mini">
              <div className="top">
                {agent.name.toLowerCase().includes("claude") ? (
                  <img src="/app/claude.webp" alt="" />
                ) : (
                  <IconBubble name="bot" size="xs" />
                )}
                <b>{agent.name}</b>
                <span className="amt">
                  {formatMoney(spent, currency)} of {formatMoney(cap, currency)}
                </span>
              </div>
              <div className="bar">
                <i style={{ width: `${cap ? Math.min(100, (spent / cap) * 100) : 0}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="foot">
        <span>Limits are enforced by your vault</span>
      </div>
    </section>
  );
}

function VaultCard({ account }: { account: string }) {
  return (
    <section className="card pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="av sm">
          <img src="/landing/tokens/near.webp" alt="" />
        </span>
        <div style={{ minWidth: 0 }}>
          <b style={{ overflowWrap: "anywhere" }}>{account}</b>
          <div className="muted" style={{ fontSize: 12.5 }}>
            Your vault
          </div>
        </div>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Only you can move this money. fliq quotes and routes payouts, but it never holds your funds.
      </p>
      <a className="link" href={explorerAccountUrl(account)} target="_blank" rel="noopener noreferrer">
        View on NEAR ↗
      </a>
    </section>
  );
}

export function WalletHome() {
  const me = useMe();
  const activity = useActivity();
  if (me.isPending) return <PageState message="Opening your wallet" />;
  if (me.isError) return <PageState message={me.error.message} />;
  const home: LocalCurrency = me.data.home_currency ?? "NGN";
  const inFlight = activity.data?.items.find(
    (item) =>
      item.status === "pending" &&
      item.kind === "payout" &&
      activity.dataUpdatedAt - new Date(item.at).getTime() < 3_600_000,
  );
  return (
    <div className="page">
      <div className="head">
        <div>
          <h1>
            {greeting()}
            {me.data.display_name ? `, ${me.data.display_name.split(" ")[0]}` : ""}
          </h1>
          <p>Your dollars sit in your own vault on NEAR. Send them to any bank in seconds.</p>
        </div>
      </div>
      <div className="cols">
        <div className="stack">
          <Balance home={home} />
          {inFlight && <LivePayout item={inFlight} />}
          <SendAgain />
          <RecentActivity />
        </div>
        <aside className="stack" aria-label="Rates and agents">
          <Rates />
          <AgentsToday />
          {me.data.vault && <VaultCard account={me.data.near_account ?? me.data.vault} />}
        </aside>
      </div>
    </div>
  );
}

export { when };
