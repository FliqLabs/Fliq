import { newId } from "../../../packages/db/src/ids.js";
import { postEntry } from "../../../packages/ledger/post.js";
import { vaultTransfer } from "../../../packages/ledger/postings.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { notFound } from "./errors.js";

type Person = { nearAccount: string | null; displayName: string | null; photoUrl: string | null; createdAt: Date };

const personView = (person: Person) => ({
  near_account: person.nearAccount as string,
  display_name: person.displayName,
  photo_url: person.photoUrl,
  member_since: person.createdAt.toISOString(),
});

// A bare label means a fliq name; anything with a dot is taken as the full account.
function fullName(name: string, config: Config): string {
  const lower = name.trim().toLowerCase();
  return lower.includes(".") ? lower : `${lower}.${config.nearRootAccount}`;
}

export async function lookupPerson(tx: Db, config: Config, name: string) {
  const person = await tx.user.findUnique({ where: { nearAccount: fullName(name, config) } });
  if (!person) throw notFound("No one on fliq has that name.");
  return personView(person);
}

export async function recentPeople(tx: Db, userId: string) {
  const sent = await tx.transfer.findMany({ where: { fromUserId: userId, toUserId: { not: OUTSIDE_FLIQ } }, orderBy: { createdAt: "desc" }, take: 50 });
  const lastPaid = new Map<string, Date>();
  for (const transfer of sent) if (!lastPaid.has(transfer.toUserId)) lastPaid.set(transfer.toUserId, transfer.createdAt);
  const people = await tx.user.findMany({ where: { id: { in: [...lastPaid.keys()].slice(0, 10) } } });
  const items = people
    .map((person) => ({ ...personView(person), last_paid_at: (lastPaid.get(person.id) as Date).toISOString() }))
    .sort((a, b) => b.last_paid_at.localeCompare(a.last_paid_at));
  return { items };
}

// A send to a NEAR wallet outside fliq has no user on the other side, so its transfer row carries this in their place.
export const OUTSIDE_FLIQ = "";

export interface ObservedTransfer {
  txHash: string;
  from: string;
  to: string;
  amount: bigint;
}

export type TransferOutcome = { status: "recorded" | "already_recorded"; transferId: string } | { status: "unknown_account" };

// Called when the NEAR watcher sees the contract move funds between two vault balances. The sender signed it;
// the backend only records it and mirrors it in the ledger. Replaying a transaction hash changes nothing.
export async function recordObservedTransfer(tx: Db, observed: ObservedTransfer): Promise<TransferOutcome> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`transfer:${observed.txHash}`}, 0))`;
  const existing = await tx.transfer.findUnique({ where: { txHash: observed.txHash } });
  if (existing) return { status: "already_recorded", transferId: existing.id };

  const [from, to] = await Promise.all([
    tx.user.findUnique({ where: { nearAccount: observed.from } }),
    tx.user.findUnique({ where: { nearAccount: observed.to } }),
  ]);
  if (!from || !to) return { status: "unknown_account" };

  const transferId = newId("tr");
  await tx.transfer.create({
    data: { id: transferId, txHash: observed.txHash, fromUserId: from.id, toUserId: to.id, fromAccount: observed.from, toAccount: observed.to, asset: "USDC", amount: observed.amount },
  });
  await postEntry(tx, vaultTransfer(transferId, observed.from, observed.to, "USDC", observed.amount));
  return { status: "recorded", transferId };
}

// USDC the user sent on from their own NEAR account to a wallet outside fliq. It left the vault with the withdraw
// before it, which the ledger does not mirror, so this only records it for Activity, once per transaction.
export async function recordOutsideSend(tx: Db, userId: string, observed: ObservedTransfer): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`transfer:${observed.txHash}`}, 0))`;
  if (await tx.transfer.findUnique({ where: { txHash: observed.txHash }, select: { id: true } })) return;
  await tx.transfer.create({
    data: { id: newId("tr"), txHash: observed.txHash, fromUserId: userId, toUserId: OUTSIDE_FLIQ, fromAccount: observed.from, toAccount: observed.to, asset: "USDC", amount: observed.amount },
  });
}
