import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { newId } from "../db/src/ids.js";
import { InsufficientVaultBalance, findProjectionDrift, postEntry, reserveVault, vaultAvailable } from "./post.js";
import { depositReceived, feeCollected, orderCommitted, settled, vaultCredited, type PayoutAmounts, type Posting } from "./postings.js";

// Throwaway local database only; Prisma loads .env, which may point at a shared one.
const enabled = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "");

describe.skipIf(!enabled)("ledger against a real database", () => {
  if (!enabled) {
    it("needs DATABASE_URL pointing at a local database", () => {});
    return;
  }

  const db = new PrismaClient({ transactionOptions: { maxWait: 30_000, timeout: 60_000 } });
  const run = randomBytes(4).toString("hex");
  const provider = `paycrest-${run}`;
  const payouts: string[] = [];

  const amounts = (): PayoutAmounts => {
    const payoutId = newId("po");
    payouts.push(payoutId);
    return { payoutId, provider, asset: "USDC", gross: 100_000_000n, routingFee: 300_000n, networkFee: 0n };
  };
  const post = (posting: Posting) => db.$transaction((tx) => postEntry(tx, posting));
  const balance = async (code: string) => (await db.balance.findFirst({ where: { account: { code } } }))?.amount ?? 0n;
  const linesOf = (payoutId: string) => db.journalLine.count({ where: { entry: { payoutId } } });

  afterAll(async () => {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.$executeRaw`DELETE FROM ledger.journal_lines WHERE entry_id IN (SELECT id FROM ledger.journal_entries WHERE payout_id = ANY(${payouts}::text[]))`;
      await tx.$executeRaw`DELETE FROM ledger.journal_entries WHERE payout_id = ANY(${payouts}::text[])`;
      await tx.$executeRaw`DELETE FROM ledger.balances WHERE account_id IN (SELECT id FROM ledger.accounts WHERE code LIKE ${`%${run}%`})`;
      await tx.$executeRaw`DELETE FROM ledger.accounts WHERE code LIKE ${`%${run}%`}`;
    });
    await db.$disconnect();
  }, 60_000);

  it("posts the spec 6.3 sequence and leaves the escrow empty once settled", async () => {
    const a = amounts();
    const escrow = `provider_escrow:${provider}:USDC`;
    await post(orderCommitted(a, { quote: "q_1" }));
    expect(await linesOf(a.payoutId)).toBe(0);

    await post(depositReceived(a));
    expect(await balance(escrow)).toBe(100_000_000n);
    await post(settled(a, { currency: "ngn" }));
    expect(await balance(escrow)).toBe(0n);
    expect(await balance(`fee_receivable:${provider}:USDC`)).toBe(300_000n);
    await post(feeCollected(a));
    expect(await balance(`fee_receivable:${provider}:USDC`)).toBe(0n);
  });

  it("creates nothing when a posting is replayed", async () => {
    const a = amounts();
    const first = await post(depositReceived(a));
    const lines = await linesOf(a.payoutId);
    const again = await post(depositReceived(a));
    expect(first.created).toBe(true);
    expect(again).toEqual({ entryId: first.entryId, created: false });
    expect(await linesOf(a.payoutId)).toBe(lines);
    expect(await balance(`provider_escrow:${provider}:USDC`)).toBeGreaterThanOrEqual(100_000_000n);
  });

  it("books one entry when the same posting arrives concurrently", async () => {
    const a = amounts();
    const results = await Promise.all(Array.from({ length: 20 }, () => post(depositReceived(a))));
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.entryId)).size).toBe(1);
    expect(await db.journalEntry.count({ where: { payoutId: a.payoutId } })).toBe(1);
  });

  it("has the database refuse an unbalanced entry and writes nothing", async () => {
    const a = amounts();
    const broken: Posting = { ...depositReceived(a), lines: depositReceived(a).lines.slice(0, 2) };
    await expect(post(broken)).rejects.toThrow(/does not sum to zero/);
    expect(await db.journalEntry.count({ where: { payoutId: a.payoutId } })).toBe(0);
  });

  it("has the database refuse edits and deletes of journal lines", async () => {
    const a = amounts();
    await post(depositReceived(a));
    await expect(db.journalLine.updateMany({ where: { entry: { payoutId: a.payoutId } }, data: { amount: 1n } })).rejects.toThrow(/append-only/);
    await expect(db.journalEntry.deleteMany({ where: { payoutId: a.payoutId } })).rejects.toThrow(/append-only/);
  });

  it("detects a deliberately corrupted projection and clears once it is repaired", async () => {
    const a = amounts();
    await post(depositReceived(a));
    const code = `provider_escrow:${provider}:USDC`;
    const mine = (rows: { code: string }[]) => rows.filter((row) => row.code.includes(run));
    expect(mine(await findProjectionDrift(db))).toEqual([]);

    const row = await db.balance.findFirstOrThrow({ where: { account: { code } } });
    await db.balance.update({ where: { accountId: row.accountId }, data: { amount: row.amount + 7n } });
    expect(mine(await findProjectionDrift(db))).toEqual([{ code, projected: row.amount + 7n, journal: row.amount }]);

    await db.balance.update({ where: { accountId: row.accountId }, data: { amount: row.amount } });
    expect(mine(await findProjectionDrift(db))).toEqual([]);
  });

  it("reserves vault funds only when the free balance covers them", async () => {
    const holder = `holder-${run}.near`;
    const topUp = newId("po");
    payouts.push(topUp);
    await post(vaultCredited(topUp, holder, "USDC", 50_000_000n));
    expect(await db.$transaction((tx) => vaultAvailable(tx, holder, "USDC"))).toBe(50_000_000n);

    const first = newId("po");
    payouts.push(first);
    expect((await db.$transaction((tx) => reserveVault(tx, first, holder, "USDC", 30_000_000n))).created).toBe(true);
    expect(await db.$transaction((tx) => vaultAvailable(tx, holder, "USDC"))).toBe(20_000_000n);
    expect((await db.$transaction((tx) => reserveVault(tx, first, holder, "USDC", 30_000_000n))).created).toBe(false);

    const second = newId("po");
    payouts.push(second);
    await expect(db.$transaction((tx) => reserveVault(tx, second, holder, "USDC", 30_000_000n))).rejects.toBeInstanceOf(InsufficientVaultBalance);
    expect(await db.$transaction((tx) => vaultAvailable(tx, holder, "USDC"))).toBe(20_000_000n);
  });

});
