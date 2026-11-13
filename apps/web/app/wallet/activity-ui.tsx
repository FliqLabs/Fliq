"use client";

/* eslint-disable @next/next/no-img-element -- provider logos are tiny fixed images */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { BigMoney, Chip, Drawer, Notice, Spinner, Avatar, Logo } from "../components/app/ui";
import { Icon } from "../components/app/icons";
import { bankLogo, chain, PROVIDERS, providerName, tokenLogo } from "../lib/assets";
import { formatMoney, formatRate, formatUsd, fromMinorUnits, toCurrency } from "../lib/money";
import { walletApi, type ActivityItem } from "../lib/wallet-api";

const REASONS: Record<NonNullable<ActivityItem["reason"]>, string> = {
  over_daily_cap: "Over the agent's daily limit, so the vault refused it.",
  over_per_payout_cap: "Over the agent's limit for one payout, so the vault refused it.",
  corridor_not_allowed: "The agent is not allowed to pay in this currency.",
  not_saved_account: "The agent can only pay saved recipients.",
  provider_failed: "The provider could not pay out, so the money went back to your vault.",
  expired: "The rate ran out before the payout started. Nothing moved.",
};

export function reasonText(item: ActivityItem) {
  return item.reason ? REASONS[item.reason] : null;
}

export function when(at: string) {
  const date = new Date(at);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === today.toDateString()) return `Today, ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return `${date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${time}`;
}

const isIncoming = (item: ActivityItem) => item.kind === "deposit" || item.kind === "transfer_in";
const isStopped = (item: ActivityItem) => ["refused", "refunded", "failed", "expired"].includes(item.status);

export function ActivityAvatar({ item, size }: { item: ActivityItem; size?: "sm" }) {
  if (item.kind === "deposit") {
    const [, network] = (item.party.name.match(/from (\w+)/i) ?? []) as string[];
    const token = item.token?.toLowerCase().includes("usdt") ? "usdt" : item.token?.toLowerCase().includes("btc") ? "btc" : "usdc";
    return <Logo src={tokenLogo(token)} badge={network ? chain(network.toLowerCase()).logo : null} size={size} />;
  }
  const badge = item.party.near_account ? "/landing/tokens/near.webp" : bankLogo(item.party.institution, item.party.name);
  return <Avatar name={item.party.name} photo={item.party.photo_url} badge={badge} size={size} />;
}

export function activityTitle(item: ActivityItem) {
  return item.party.name;
}

export function activitySub(item: ActivityItem) {
  const parts = [when(item.at)];
  if (item.kind === "deposit" && item.token) parts.push(item.token);
  if (item.provider) parts.push(providerName(item.provider));
  if (item.kind === "transfer_in" || item.kind === "transfer_out") parts.push("fliq to fliq");
  if (item.agent) parts.push(`by ${item.agent.name}`);
  return parts.join(" · ");
}

export function StatusChip({ item }: { item: ActivityItem }) {
  if (item.status === "refused") return <Chip tone="bad">Refused</Chip>;
  if (item.status === "refunded") return <Chip tone="sand">Refunded</Chip>;
  if (item.status === "failed" || item.status === "expired") return <Chip tone="bad">Stopped</Chip>;
  if (item.status === "pending") return <Chip tone="acc">Sending</Chip>;
  return <Chip tone="good">{isIncoming(item) ? "Received" : "Paid"}</Chip>;
}

export function AmountCell({ item }: { item: ActivityItem }) {
  if (isIncoming(item)) {
    return (
      <>
        <b style={{ color: "var(--good)" }}>+{formatUsd(item.usd ?? "0")}</b>
        <span>{item.kind === "deposit" ? "in your vault" : "from fliq"}</span>
      </>
    );
  }
  const main = item.local ? formatMoney(item.local.amount, toCurrency(item.local.currency)) : formatUsd(item.usd ?? "0");
  const sub =
    item.status === "refused" ? (
      <span style={{ color: "var(--bad)" }}>Refused</span>
    ) : item.status === "refunded" ? (
      <span style={{ color: "var(--warn)" }}>Refunded</span>
    ) : item.status === "pending" ? (
      <span style={{ color: "var(--accent)" }}>Sending</span>
    ) : (
      <span>{item.local && item.usd ? formatUsd(item.usd) : "to fliq"}</span>
    );
  return (
    <>
      <b>{isStopped(item) ? <s>{main}</s> : main}</b>
      {sub}
    </>
  );
}

export function ActivityRow({ item, onOpen }: { item: ActivityItem; onOpen: (item: ActivityItem) => void }) {
  return (
    <button type="button" className="row" onClick={() => onOpen(item)}>
      <ActivityAvatar item={item} />
      <div className="t">
        <b>{activityTitle(item)}</b>
        <span>{activitySub(item)}</span>
      </div>
      <div className="r">
        <AmountCell item={item} />
      </div>
    </button>
  );
}

function Hero({ item }: { item: ActivityItem }) {
  const tone = item.status === "refused" || item.status === "failed" ? "bad" : item.status === "refunded" ? "warn" : null;
  const icon = isIncoming(item) ? "down" : item.status === "refunded" ? "refresh" : tone ? "x" : item.status === "pending" ? "clock" : "check";
  const amount = item.local && !isIncoming(item) ? <BigMoney value={item.local.amount} currency={toCurrency(item.local.currency)} /> : <BigMoney value={item.usd ?? "0"} currency="USD" />;
  const verb = isIncoming(item)
    ? "landed in your vault"
    : item.status === "refused"
      ? "was not sent to"
      : item.status === "refunded"
        ? "did not reach"
        : item.status === "pending"
          ? "is on its way to"
          : "landed with";
  return (
    <div className="paid-hero" style={{ padding: "10px 0 0" }}>
      <div
        className="okc"
        style={tone ? { background: `var(--${tone}-soft)`, color: `var(--${tone})` } : item.status === "pending" ? { background: "var(--accent-soft)", color: "var(--accent)" } : undefined}
      >
        <Icon name={icon} size={28} />
      </div>
      <div className="big">{amount}</div>
      <div className="muted">
        {verb} {isIncoming(item) ? "" : item.party.name} · {when(item.at)}
      </div>
    </div>
  );
}

function PayoutDetails({ item }: { item: ActivityItem }) {
  const payout = useQuery({ queryKey: ["payout", item.ref_id], queryFn: () => walletApi.payout(item.ref_id), retry: false });
  if (payout.isPending) return <Notice icon="spin">Loading the receipt</Notice>;
  if (payout.isError) return <Notice tone="bad">{payout.error.message}</Notice>;
  const p = payout.data;
  const currency = toCurrency(p.currency);
  const provider = PROVIDERS[p.provider];
  return (
    <dl className="kv card" style={{ margin: 0 }}>
      <div>
        <dt>Sent</dt>
        <dd>{formatUsd(p.amount)}</dd>
      </div>
      <div>
        <dt>Rate after fees</dt>
        <dd>$1 = {formatRate(p.rate, currency)}</dd>
      </div>
      <div>
        <dt>Fees</dt>
        <dd>
          {formatMoney(fromMinorUnits(p.fees.provider), currency)} provider · {formatMoney(fromMinorUnits(p.fees.network), currency)} network
        </dd>
      </div>
      <div>
        <dt>Paid out by</dt>
        <dd style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
          {provider.logo && <img src={provider.logo} alt="" style={{ width: 18, height: 18, borderRadius: "50%" }} />}
          {provider.name}
        </dd>
      </div>
      {p.settlement_name && (
        <div>
          <dt>Bank alert shows</dt>
          <dd>{p.settlement_name}</dd>
        </div>
      )}
      {p.bank_reference && (
        <div>
          <dt>{currency === "NGN" ? "NIP session" : "Reference"}</dt>
          <dd className="mono">{p.bank_reference}</dd>
        </div>
      )}
      {p.seconds != null && (
        <div>
          <dt>Took</dt>
          <dd>{p.seconds} seconds</dd>
        </div>
      )}
      <div>
        <dt>Payout</dt>
        <dd className="mono">{p.payout_id}</dd>
      </div>
    </dl>
  );
}

export function ReceiptDrawer({ item, onClose }: { item: ActivityItem; onClose: () => void }) {
  const reason = reasonText(item);
  const isPayout = item.kind === "payout" && item.ref_id.startsWith("po_");
  return (
    <Drawer
      title="Receipt"
      onClose={onClose}
      footer={
        isPayout ? (
          <Link className="btn ink lg" href={`/wallet/payouts/${encodeURIComponent(item.ref_id)}`}>
            {item.status === "pending" ? "Track live" : "Open receipt"}
          </Link>
        ) : undefined
      }
    >
      <Hero item={item} />
      {reason && <Notice tone={item.status === "refused" ? "bad" : "warn"}>{reason}</Notice>}
      {isPayout ? (
        <PayoutDetails item={item} />
      ) : (
        <dl className="kv card" style={{ margin: 0 }}>
          {item.token && (
            <div>
              <dt>{isIncoming(item) ? "You sent" : "Token"}</dt>
              <dd>{item.token}</dd>
            </div>
          )}
          {item.usd && (
            <div>
              <dt>{isIncoming(item) ? "Landed" : "Amount"}</dt>
              <dd>{formatUsd(item.usd)} USDC</dd>
            </div>
          )}
          {item.local && (
            <div>
              <dt>Asked for</dt>
              <dd>{formatMoney(item.local.amount, toCurrency(item.local.currency))}</dd>
            </div>
          )}
          {item.agent && (
            <div>
              <dt>Requested by</dt>
              <dd>{item.agent.name}</dd>
            </div>
          )}
          {item.party.near_account && (
            <div>
              <dt>{isIncoming(item) ? "From" : "To"}</dt>
              <dd>{item.party.near_account}</dd>
            </div>
          )}
          {item.seconds != null && (
            <div>
              <dt>Took</dt>
              <dd>{item.seconds} seconds</dd>
            </div>
          )}
          <div>
            <dt>Reference</dt>
            <dd className="mono">{item.ref_id}</dd>
          </div>
        </dl>
      )}
    </Drawer>
  );
}

export function LoadingRows() {
  return (
    <div className="empty">
      <Spinner />
    </div>
  );
}
