import type { Prisma } from "@prisma/client";
import { newId } from "../db/src/ids.js";
import { account, type Asset } from "./accounts.js";
import { vaultReserved, type Posting } from "./postings.js";

type Db = Prisma.TransactionClient;

export interface PostResult {
  entryId: string;
  created: boolean;
}

export class InsufficientVaultBalance extends Error {}

// Spec 7.3: the key is the payout id and the posting type, so replaying an event creates nothing.
// The lock lets two callers racing on one key run one after the other instead of colliding on the unique index.
export async function postEntry(tx: Db, posting: Posting): Promise<PostResult> {
  const key = `${posting.payoutId}:${posting.type}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ledger:${key}`}, 0))`;
  const existing = await tx.journalEntry.findUnique({ where: { idempotencyKey: key }, select: { id: true } });
  if (existing) return { entryId: existing.id, created: false };

  const entryId = newId("je");
  await tx.journalEntry.create({
    data: {
      id: entryId,
      payoutId: posting.payoutId,
      postingType: posting.type,
      idempotencyKey: key,
      memo: posting.memo ? JSON.stringify(posting.memo) : null,
    },
  });

  const accountIds = new Map<string, string>();
  for (const { account: ref } of posting.lines) {
    if (accountIds.has(ref.code)) continue;
    const row = await tx.account.upsert({
      where: { code: ref.code },
      update: {},
      create: { id: newId("acc"), code: ref.code, type: ref.type, asset: ref.asset, ownerId: ref.owner },
    });
    accountIds.set(ref.code, row.id);
  }

  const deltas = new Map<string, bigint>();
  for (const line of posting.lines) {
    const accountId = accountIds.get(line.account.code) as string;
    deltas.set(accountId, (deltas.get(accountId) ?? 0n) + line.amount);
  }
  if (posting.lines.length > 0) {
    await tx.journalLine.createMany({
      data: posting.lines.map((line) => ({
        id: newId("jl"),
        entryId,
        accountId: accountIds.get(line.account.code) as string,
        asset: line.account.asset,
        amount: line.amount,
      })),
    });
  }
  // The projection moves in the same transaction as the journal, by addition so concurrent postings cannot lose an update.
  for (const [accountId, delta] of deltas) {
    await tx.$executeRaw`
      INSERT INTO ledger.balances (account_id, amount, reserved, updated_at) VALUES (${accountId}, ${delta}, 0, now())
      ON CONFLICT (account_id) DO UPDATE SET amount = ledger.balances.amount + EXCLUDED.amount, updated_at = now()`;
  }
  return { entryId, created: true };
}

export async function vaultAvailable(tx: Db, holder: string, asset: Asset): Promise<bigint> {
  const row = await tx.balance.findFirst({ where: { account: { code: account("vault_available", asset, holder).code } } });
  return -(row?.amount ?? 0n);
}

// Reserves the funding balance for a vault payout, refusing when the free balance cannot cover it.
export async function reserveVault(tx: Db, payoutId: string, holder: string, asset: Asset, amount: bigint): Promise<PostResult> {
  const posting = vaultReserved(payoutId, holder, asset, amount);
  const already = await tx.journalEntry.findUnique({ where: { idempotencyKey: `${payoutId}:${posting.type}` }, select: { id: true } });
  if (already) return { entryId: already.id, created: false };
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`vault:${holder}:${asset}`}, 0))`;
  if ((await vaultAvailable(tx, holder, asset)) < amount) throw new InsufficientVaultBalance(`not enough free balance for ${holder}`);
  return postEntry(tx, posting);
}

export interface Drift {
  code: string;
  projected: bigint;
  journal: bigint;
}

// The nightly recompute: every account's projected balance must equal the sum of its journal lines.
export async function findProjectionDrift(tx: Db): Promise<Drift[]> {
  return tx.$queryRaw<Drift[]>`
    SELECT a.code, coalesce(b.amount, 0)::bigint AS projected, coalesce(j.total, 0)::bigint AS journal
    FROM ledger.accounts a
    LEFT JOIN ledger.balances b ON b.account_id = a.id
    LEFT JOIN (SELECT account_id, sum(amount) AS total FROM ledger.journal_lines GROUP BY account_id) j ON j.account_id = a.id
    WHERE coalesce(b.amount, 0) <> coalesce(j.total, 0)
    ORDER BY a.code`;
}
