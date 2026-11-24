import { describe, expect, it } from "vitest";
import { planCorrection, reconcileVaultMirror } from "../apps/api/src/vault-reconcile.js";
import { vaultReconciled } from "../packages/ledger/postings.js";
import type { Unit } from "../apps/api/src/db.js";

const usdc = (whole: number) => BigInt(Math.round(whole * 1_000_000));

describe("vault mirror reconcile", () => {
  const free = (available: bigint, reserved = 0n) => ({ available, reserved });

  it("takes the vault contract as the truth in both directions", () => {
    expect(
      planCorrection("dapper.near", "USDC", free(usdc(12.765942)), free(usdc(1.865942)))?.delta.available,
    ).toBe(-usdc(10.9));
    expect(
      planCorrection("sejiro.near", "USDC", free(-usdc(2.9445)), free(usdc(0.0555)))?.delta.available,
    ).toBe(usdc(3));
    expect(planCorrection("derin.near", "USDC", free(5n), free(5n))).toBeNull();
  });

  it("clears a reservation the mirror kept after the payout finished", () => {
    const fix = planCorrection(
      "faiz.near",
      "USDC",
      free(usdc(3.581198), usdc(6.170934)),
      free(usdc(3.593861)),
    );
    expect(fix?.skipped).toBeUndefined();
    expect(fix?.delta).toEqual({ available: usdc(0.012663), reserved: -usdc(6.170934) });
  });

  it("leaves a holder the contract still shows with a reservation for the next run", () => {
    expect(planCorrection("faiz.near", "USDC", free(1n), free(2n, 7n))?.skipped).toBe("payout_in_flight");
  });

  it("writes entries that balance", () => {
    for (const delta of [
      { available: usdc(3), reserved: 0n },
      { available: -usdc(10.9), reserved: -usdc(6.17) },
    ]) {
      const posting = vaultReconciled("rec_run", "holder.near", "USDC", delta, { reason: "chain_reconcile" });
      expect(posting.lines.reduce((sum, line) => sum + line.amount, 0n)).toBe(0n);
      expect(posting.type).toBe("VAULT_RECONCILED");
    }
  });

  it("only logs in dry run", async () => {
    const posted: unknown[] = [];
    const tx = {
      account: { findMany: async () => [{ ownerId: "dapper.near", asset: "USDC" }] },
      balance: {
        findFirst: async ({ where }: { where: { account: { code: string } } }) =>
          where.account.code.startsWith("vault_available")
            ? { amount: -usdc(12.765942) }
            : { amount: -usdc(1) },
      },
      $executeRaw: async () => posted.push("lock"),
    };
    const unit = (async (fn: (db: typeof tx) => Promise<unknown>) => fn(tx)) as unknown as Unit;
    const logs: string[] = [];
    const result = await reconcileVaultMirror({
      unit,
      chainBalance: async () => free(usdc(1.865942)),
      now: () => new Date("2026-11-24T18:00:00Z"),
      log: (line) => logs.push(line),
      apply: false,
    });
    expect(result[0]?.applied).toBe(false);
    expect(result[0]?.delta.reserved).toBe(-usdc(1));
    expect(posted).toHaveLength(0);
    expect(logs[0]).toContain("dry_run");
  });
});
