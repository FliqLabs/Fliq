import type { VaultDeposit } from "@prisma/client";
import { decrypt } from "../../../packages/db/src/crypto.js";
import type { Config } from "./config.js";
import { formatTokenAmount } from "./dashboard.js";
import type { Db } from "./db.js";
import { formatUnits } from "./deposits.js";
import { invalidRequest } from "./errors.js";
import { institutionName } from "./institutions.js";
import { developerIdFor } from "./quotes.js";

export type ActivityFilter = "all" | "mine" | "agents";

type Party = { name: string; near_account: string | null; institution: string | null; account_last4: string | null; photo_url: string | null };

export type ActivityItem = {
  activity_id: string;
  kind: "payout" | "deposit" | "transfer_in" | "transfer_out" | "refused";
  status: "pending" | "paid" | "received" | "sent" | "refunded" | "refused" | "failed" | "expired";
  at: string;
  party: Party;
  provider: string | null;
  agent: { agent_id: string; name: string } | null;
  local: { amount: string; currency: string } | null;
  usd: string | null;
  token: string | null;
  seconds: number | null;
  reason: string | null;
  ref_id: string;
  /** The NEAR transaction, so a receipt can point anyone to it on an explorer. Only transfers have one today. */
  tx_hash: string | null;
};

const CHAIN_NAMES: Record<string, string> = {
  base: "Base",
  solana: "Solana",
  tron: "Tron",
  bnb: "BNB Chain",
  arbitrum: "Arbitrum",
  ethereum: "Ethereum",
  polygon: "Polygon",
  bitcoin: "Bitcoin",
  near: "NEAR",
};

const SEND_STATUS: Record<string, ActivityItem["status"]> = { delivered: "sent", refunded: "refunded", failed: "failed", expired: "expired" };
const shortAddress = (address: string) => (address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address);

const REFUSAL_REASONS: Record<string, string> = {
  POLICY_DAILY_CAP: "over_daily_cap",
  POLICY_PER_PAYOUT_CAP: "over_per_payout_cap",
  POLICY_CORRIDOR: "corridor_not_allowed",
  SAVED_ACCOUNTS_ONLY: "not_saved_account",
};

const party = (name: string, extra: Partial<Party> = {}): Party => ({ name, near_account: null, institution: null, account_last4: null, photo_url: null, ...extra });

const PAYOUT_STATUS: Record<string, ActivityItem["status"]> = { settled: "paid", refunded: "refunded", expired: "expired", failed: "failed" };
const DEPOSIT_STATUS: Record<string, ActivityItem["status"]> = { landed: "received", refunded: "refunded", expired: "expired", failed: "failed" };
const REFUND_BACK = "Refund back in your vault";
// The iPhone app matches this name to draw a bank deposit with the Nigerian flag.
const FROM_BANK = "From your bank";

const encodeCursor = (item: ActivityItem) => Buffer.from(`${item.at}|${item.activity_id}`).toString("base64url");

function decodeCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const date = new Date(at ?? "");
  if (!id || Number.isNaN(date.getTime())) throw invalidRequest("cursor is not one this API returned.");
  return { at: date, id };
}

// Newest first, ties broken by id, so pages never repeat or skip a row.
const newerFirst = (a: ActivityItem, b: ActivityItem) => b.at.localeCompare(a.at) || b.activity_id.localeCompare(a.activity_id);

async function payouts(tx: Db, config: Config, userId: string, filter: ActivityFilter, before: Date | null, take: number): Promise<ActivityItem[]> {
  const byWhom = filter === "mine" ? { agentId: null } : filter === "agents" ? { agentId: { not: null } } : {};
  const rows = await tx.payout.findMany({
    where: {
      developerId: await developerIdFor(tx, userId),
      ...byWhom,
      ...(before ? { createdAt: { lte: before } } : {}),
      // The app already told the payer it did not start. Nothing left the vault.
      OR: [{ failureReason: null }, { failureReason: { not: "not_signed" } }],
    },
    orderBy: { createdAt: "desc" },
    take,
    include: { recipient: true, events: { where: { toState: { in: ["deposit_seen", "settled"] } } } },
  });
  const agents = await tx.agent.findMany({ where: { id: { in: rows.flatMap((row) => (row.agentId ? [row.agentId] : [])) } }, select: { id: true, name: true } });
  return rows.map((row) => {
    const seen = row.events.find((event) => event.toState === "deposit_seen")?.createdAt;
    const settled = row.events.find((event) => event.toState === "settled")?.createdAt;
    return {
      activity_id: `act_${row.id}`,
      kind: "payout",
      status: PAYOUT_STATUS[row.state] ?? "pending",
      at: row.createdAt.toISOString(),
      party: party(decrypt(row.recipient.nameCipher, config.dataKey), {
        institution: row.recipient.institutionCode,
        account_last4: decrypt(row.recipient.accountCipher, config.dataKey).slice(-4),
      }),
      provider: row.provider,
      agent: row.agentId ? { agent_id: row.agentId, name: agents.find((agent) => agent.id === row.agentId)?.name ?? row.agentId } : null,
      local: { amount: String(row.amountOutMinor / 100n), currency: row.currency.toUpperCase() },
      usd: formatTokenAmount(row.amountIn),
      token: null,
      seconds: seen && settled ? Math.round((settled.getTime() - seen.getTime()) / 1000) : null,
      reason: row.state === "refunded" ? "provider_failed" : row.state === "expired" ? "expired" : null,
      ref_id: row.id,
      tx_hash: null,
    };
  });
}

// A bank deposit moves through the partner before anything reaches the chain, so its address can be "waiting" or even
// "expired" while the naira is on its way. Its row follows the partner instead, for a day.
const BANK_FOLLOWED_MS = 24 * 60 * 60_000;
const BANK_STOPPED = ["ERROR", "FAILED"];

function depositStatus(row: VaultDeposit, now: Date): { status: ActivityItem["status"]; reason: string | null } {
  if (row.state === "landed") return { status: "received", reason: null };
  if (row.fromBank && row.bankStatus && BANK_STOPPED.includes(row.bankStatus)) return { status: "failed", reason: "bank_stopped" };
  const followed = row.fromBank && (row.bankSentAt !== null || row.bankStatus !== null) && now.getTime() - row.createdAt.getTime() < BANK_FOLLOWED_MS;
  if (followed && (row.state === "waiting" || row.state === "expired")) return { status: "pending", reason: null };
  return { status: DEPOSIT_STATUS[row.state] ?? "pending", reason: row.state === "expired" ? "expired" : null };
}

async function deposits(tx: Db, userId: string, before: Date | null, take: number): Promise<ActivityItem[]> {
  const rows = await tx.vaultDeposit.findMany({
    where: {
      userId,
      // A bank deposit is listed from the moment the user says they sent it, before anything reaches its address.
      OR: [{ state: { notIn: ["waiting"] } }, { fromBank: true, OR: [{ bankSentAt: { not: null } }, { bankStatus: { in: ["PAID", "COMPLETED", ...BANK_STOPPED] } }] }],
      ...(before ? { createdAt: { lte: before } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take,
  });
  const now = new Date();
  return rows.map((row) => {
    const received = row.receivedUnits ?? row.amountUnits;
    const { status, reason } = depositStatus(row, now);
    return {
      activity_id: `act_${row.id}`,
      kind: "deposit",
      status,
      at: row.createdAt.toISOString(),
      party: party(row.refundReturn ? REFUND_BACK : row.fromBank ? FROM_BANK : `Received from ${CHAIN_NAMES[row.chain] ?? row.chain}`),
      provider: null,
      agent: null,
      local: null,
      usd: formatUnits(row.landedUnits ?? row.landsUnits, 6),
      token: `${formatUnits(received, row.decimals).replace(/\.00$/, "")} ${row.token.toUpperCase()}`,
      seconds: row.seenAt && row.landedAt ? Math.round((row.landedAt.getTime() - row.seenAt.getTime()) / 1000) : null,
      reason,
      ref_id: row.id,
      tx_hash: null,
    };
  });
}

async function transfers(tx: Db, userId: string, before: Date | null, take: number): Promise<ActivityItem[]> {
  const rows = await tx.transfer.findMany({
    where: { OR: [{ fromUserId: userId }, { toUserId: userId }], ...(before ? { createdAt: { lte: before } } : {}) },
    orderBy: { createdAt: "desc" },
    take,
  });
  const others = await tx.user.findMany({
    where: { id: { in: rows.map((row) => (row.fromUserId === userId ? row.toUserId : row.fromUserId)) } },
    select: { id: true, displayName: true, photoUrl: true },
  });
  // A transfer to a NEAR Intents deposit address is a send to a wallet on another network: it is shown by where it
  // is really going and how far it has got, not by the deposit address it passed through.
  const sends = await tx.walletSend.findMany({
    where: { userId, depositAddress: { in: rows.filter((row) => row.fromUserId === userId).map((row) => row.toAccount) } },
    select: { depositAddress: true, chain: true, toAddress: true, state: true },
  });
  return rows.map((row) => {
    const outgoing = row.fromUserId === userId;
    const other = others.find((user) => user.id === (outgoing ? row.toUserId : row.fromUserId));
    const account = outgoing ? row.toAccount : row.fromAccount;
    const send = outgoing ? sends.find((item) => item.depositAddress === row.toAccount) : undefined;
    return {
      activity_id: `act_${row.id}`,
      kind: outgoing ? "transfer_out" : "transfer_in",
      status: send ? (SEND_STATUS[send.state] ?? "pending") : outgoing ? "sent" : "received",
      at: row.createdAt.toISOString(),
      party: send
        ? party(`${CHAIN_NAMES[send.chain] ?? send.chain} wallet ${shortAddress(send.toAddress)}`)
        : party(other?.displayName ?? account, { near_account: account, photo_url: other?.photoUrl ?? null }),
      provider: null,
      agent: null,
      local: null,
      usd: formatTokenAmount(row.amount),
      token: null,
      seconds: null,
      reason: null,
      ref_id: row.id,
      tx_hash: row.txHash,
    };
  });
}

async function refusals(tx: Db, userId: string, before: Date | null, take: number): Promise<ActivityItem[]> {
  const rows = await tx.agentRefusal.findMany({ where: { userId, ...(before ? { createdAt: { lte: before } } : {}) }, orderBy: { createdAt: "desc" }, take });
  const agents = await tx.agent.findMany({ where: { id: { in: rows.map((row) => row.agentId) } }, select: { id: true, name: true } });
  return rows.map((row) => {
    const name = agents.find((agent) => agent.id === row.agentId)?.name ?? row.agentId;
    return {
      activity_id: `act_${row.id}`,
      kind: "refused",
      status: "refused",
      at: row.createdAt.toISOString(),
      party: party(name),
      provider: null,
      agent: { agent_id: row.agentId, name },
      local: row.amountMinor !== null && row.currency ? { amount: String(row.amountMinor / 100n), currency: row.currency } : null,
      usd: null,
      token: null,
      seconds: null,
      reason: REFUSAL_REASONS[row.reason] ?? null,
      ref_id: row.id,
      tx_hash: null,
    };
  });
}

export function parseFilter(raw: string | undefined): ActivityFilter {
  const filter = raw ?? "all";
  if (filter !== "all" && filter !== "mine" && filter !== "agents") throw invalidRequest("filter must be all, mine or agents.");
  return filter;
}

// Each source gives its newest rows up to the cursor; the merged list keeps the page's worth after it.
export async function listActivity(tx: Db, config: Config, userId: string, filter: ActivityFilter, limit: number, cursor: string | undefined) {
  const after = decodeCursor(cursor);
  const before = after?.at ?? null;
  const take = limit + 1;
  const sources = await Promise.all([
    payouts(tx, config, userId, filter, before, take),
    filter === "agents" ? [] : deposits(tx, userId, before, take),
    filter === "agents" ? [] : transfers(tx, userId, before, take),
    filter === "mine" ? [] : refusals(tx, userId, before, take),
  ]);
  const merged = sources
    .flat()
    .filter((item) => !after || item.at < after.at.toISOString() || (item.at === after.at.toISOString() && item.activity_id < after.id))
    .sort(newerFirst);
  const page = merged.slice(0, limit);
  const last = page.at(-1);
  return { items: page, next_cursor: merged.length > limit && last ? encodeCursor(last) : null };
}

const SYMBOLS: Record<string, string> = { NGN: "₦", KES: "KSh ", GHS: "GH₵", USD: "$" };
const money = (amount: string, currency: string) => `${SYMBOLS[currency] ?? `${currency} `}${Number(amount).toLocaleString("en-US")}`;

function notificationFor(item: ActivityItem) {
  const base = { notification_id: item.activity_id.replace(/^act_/, "ntf_"), at: item.at, activity_id: item.activity_id };
  const local = item.local ? money(item.local.amount, item.local.currency) : null;
  const bank = item.party.institution ? `${institutionName(item.party.institution)} account` : "account";
  const via = item.provider ? `${item.provider.charAt(0).toUpperCase()}${item.provider.slice(1)}` : "the provider";
  if (item.kind === "payout" && item.status === "paid" && item.agent) {
    const bank = item.party.institution ? `, ${institutionName(item.party.institution)}` : "";
    return { ...base, kind: "agent_paid", title: `${item.agent.name} paid ${local}`, body: `To ${item.party.name}${bank}, via ${via}.` };
  }
  if (item.kind === "payout" && item.status === "paid") {
    const time = item.seconds === null ? "" : ` in ${item.seconds}s`;
    return { ...base, kind: "payout_paid", title: "Paid", body: `${local} landed in ${item.party.name}'s ${bank}. Paid by ${via}${time}.` };
  }
  if (item.kind === "payout" && item.status === "refunded") {
    return { ...base, kind: "payout_refunded", title: "Refunded", body: `$${item.usd} is back in your vault. ${via} could not pay ${item.party.name}.` };
  }
  if (item.kind === "deposit" && item.status === "received" && item.party.name === REFUND_BACK) {
    return { ...base, kind: "received", title: "Received", body: `Your $${item.usd} refund is back in your vault.` };
  }
  if (item.kind === "deposit" && item.status === "received") {
    const time = item.seconds === null ? "" : `, ${item.seconds} seconds after you sent it`;
    return { ...base, kind: "received", title: "Received", body: `$${item.usd} ${item.party.name.replace(/^Received /, "")} is in your vault${time}.` };
  }
  if (item.kind === "transfer_in") {
    return { ...base, kind: "received", title: "Received", body: `$${item.usd} from ${item.party.name} is in your vault.` };
  }
  if (item.kind === "refused" && item.agent) {
    const tried = local ? ` tried ${local}` : " was refused";
    return { ...base, kind: "agent_refused", title: `Refused: ${item.agent.name}${tried}`, body: "The vault refused it; nothing moved." };
  }
  return null;
}

export async function listNotifications(tx: Db, config: Config, userId: string, limit: number) {
  const { items } = await listActivity(tx, config, userId, "all", limit, undefined);
  return { items: items.map(notificationFor).filter((item) => item !== null) };
}
