import { describe, expect, it } from "vitest";
import { planCorrection, reconcileVaultMirror } from "../apps/api/src/vault-reconcile.js";
import { vaultReconciled } from "../packages/ledger/postings.js";
import type { Unit } from "../apps/api/src/db.js";

const usdc = (whole: number) => BigInt(Math.round(whole * 1_000_000));

describe("vault mirror reconcile", () => {
  it("takes the vault contract as the truth in both directions", () => {
    expect(
      planCorrection(
        "dapper.fliqaccount.near",
        "USDC",
        { available: usdc(12.765942), reserved: 0n },
        { available: usdc(1.865942), reserved: 0n },
      )?.delta,
    ).toBe(-usdc(10.9));
    expect(
      planCorrection(
        "sejiro.fliqaccount.near",
        "USDC",
        { available: -usdc(2.9445), reserved: 0n },
        { available: usdc(0.0555), reserved: 0n },
      )?.delta,
    ).toBe(usdc(3));
    expect(
      planCorrection(
        "derin.fliqaccount.near",
        "USDC",
        { available: 5n, reserved: 0n },
        { available: 5n, reserved: 0n },
      ),
    ).toBeNull();
  });

  it("leaves a holder with a payout in flight for the next run", () => {
    expect(
      planCorrection(
        "faiz.fliqaccount.near",
        "USDC",
        { available: 1n, reserved: 0n },
        { available: 2n, reserved: 7n },
      )?.skipped,
    ).toBe("payout_in_flight");
  });

  it("writes entries that balance", () => {
    for (const delta of [usdc(3), -usdc(10.9)]) {
      const posting = vaultReconciled("rec_run", "holder.near", "USDC", delta, { reason: "chain_reconcile" });
      expect(posting.lines.reduce((sum, line) => sum + line.amount, 0n)).toBe(0n);
      expect(posting.type).toBe("VAULT_RECONCILED");
    }
  });

  it("only logs in dry run", async () => {
    const posted: unknown[] = [];
    const tx = {
      account: { findMany: async () => [{ ownerId: "dapper.fliqaccount.near", asset: "USDC" }] },
      balance: {
        findFirst: async ({ where }: { where: { account: { code: string } } }) =>
          where.account.code.startsWith("vault_available") ? { amount: -usdc(12.765942) } : { amount: 0n },
      },
      $executeRaw: async () => posted.push("lock"),
    };
    const unit = (async (fn: (db: typeof tx) => Promise<unknown>) => fn(tx)) as unknown as Unit;
    const logs: string[] = [];
    const result = await reconcileVaultMirror({
      unit,
      chainBalance: async () => ({ available: usdc(1.865942), reserved: 0n }),
      now: () => new Date("2026-11-24T18:00:00Z"),
      log: (line) => logs.push(line),
      apply: false,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.applied).toBe(false);
    expect(posted).toHaveLength(0);
    expect(logs[0]).toContain("dry_run");
  });
});
