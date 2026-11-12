import { describe, expect, it } from "vitest";
import type { VaultReceipt } from "../packages/chains/vault/index.js";
import type { Unit } from "../apps/api/src/db.js";
import {
  dispatchFloat,
  floatCanPay,
  floatCovers,
  FloatNotSent,
  MIN_FLOAT_ETH_WEI,
  type FloatWallet,
} from "../apps/api/src/float.js";

const NOW = new Date("2026-11-12T12:00:00Z");
const PAYCREST = "0x24015eB546f531440898000A79C7109032CCfBBE";

type Row = {
  id: string;
  state: string;
  createdAt: Date;
  floatTarget: string | null;
  floatUnits: bigint | null;
  floatClaimedAt: Date | null;
  floatTxHash: string | null;
};

const row = (over: Partial<Row> = {}): Row => ({
  id: "po_1",
  state: "awaiting_deposit",
  createdAt: NOW,
  floatTarget: PAYCREST,
  floatUnits: 10_015_580n,
  floatClaimedAt: null,
  floatTxHash: null,
  ...over,
});

// Just enough of Prisma for the float: the filters it uses on payouts.
function database(rows: Row[]): Unit {
  const matches = (r: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, want]) => {
      const value = r[key as keyof Row];
      if (want === null) return value === null;
      if (typeof want === "object" && want !== null) {
        const filter = want as { not?: null; in?: string[]; gte?: Date };
        if ("not" in filter) return value !== null;
        if (filter.in) return filter.in.includes(value as string);
        if (filter.gte) return (value as Date) >= filter.gte;
      }
      return value === want;
    });
  const tx = {
    payout: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        rows.filter((r) => matches(r, where)),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
        const hit = rows.filter((r) => matches(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) =>
        Object.assign(rows.find((r) => r.id === where.id)!, data),
    },
  };
  return ((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) as unknown as Unit;
}

function wallet(usdc: bigint, eth = MIN_FLOAT_ETH_WEI, transfer?: FloatWallet["transferUsdc"]) {
  const sent: { to: string; units: bigint }[] = [];
  const w: FloatWallet = {
    address: "0xF10a7000000000000000000000000000000000aa",
    balances: async () => ({ usdc, eth }),
    transferUsdc:
      transfer ??
      (async (to, units) => {
        sent.push({ to, units });
        return `0xhash${sent.length}`;
      }),
  };
  return { w, sent };
}

const vaultWith = (transferState: VaultReceipt["transferState"] | null) => ({
  getReceipt: async () => (transferState ? ({ transferState } as VaultReceipt) : null),
});

const deps = (
  rows: Row[],
  w: FloatWallet,
  transferState: VaultReceipt["transferState"] | null = "dispatched",
) => ({
  unit: database(rows),
  vault: vaultWith(transferState),
  wallet: w,
  now: () => NOW,
  log: () => {},
});

describe("choosing the float", () => {
  it("covers a payout it holds enough USDC and gas for", async () => {
    expect(await floatCovers(wallet(50_000_000n).w, 10_000_000n)).toBe(true);
  });

  it("leaves a payout larger than the float to 1Click", async () => {
    expect(await floatCovers(wallet(50_000_000n).w, 1_000_000_000n)).toBe(false);
  });

  it("leaves everything to 1Click when the float cannot pay gas", async () => {
    expect(await floatCovers(wallet(50_000_000n, MIN_FLOAT_ETH_WEI - 1n).w, 1_000_000n)).toBe(false);
  });

  it("says no when the balance cannot be read", async () => {
    const broken: FloatWallet = { ...wallet(0n).w, balances: async () => Promise.reject(new Error("rpc")) };
    expect(await floatCovers(broken, 1n)).toBe(false);
  });

  it("counts what the float already owes to payouts it has not paid", async () => {
    const owing = [row({ floatUnits: 30_000_000n })];
    const { w } = wallet(40_000_000n);
    expect(await floatCanPay(w, database(owing), 5_000_000n, NOW)).toBe(true);
    expect(await floatCanPay(w, database(owing), 15_000_000n, NOW)).toBe(false);
    expect(await floatCanPay(w, database([]), 15_000_000n, NOW)).toBe(true);
  });
});

describe("paying the provider from the float", () => {
  it("waits until the vault has really sent the user's USDC", async () => {
    const rows = [row()];
    const { w, sent } = wallet(50_000_000n);
    expect(await dispatchFloat(deps(rows, w, "executing"))).toEqual([
      { payoutId: "po_1", outcome: "waiting" },
    ]);
    expect(await dispatchFloat(deps(rows, w, null))).toEqual([{ payoutId: "po_1", outcome: "waiting" }]);
    expect(sent).toEqual([]);
  });

  it("sends the order's amount to the provider once and records the transfer", async () => {
    const rows = [row()];
    const { w, sent } = wallet(50_000_000n);
    expect(await dispatchFloat(deps(rows, w))).toEqual([{ payoutId: "po_1", outcome: "sent" }]);
    expect(await dispatchFloat(deps(rows, w))).toEqual([]);
    expect(sent).toEqual([{ to: PAYCREST, units: 10_015_580n }]);
    expect(rows[0]!.floatTxHash).toBe("0xhash1");
  });

  it("never pays twice when two replicas see the same payout", async () => {
    const rows = [row()];
    const { w, sent } = wallet(50_000_000n);
    await Promise.all([dispatchFloat(deps(rows, w)), dispatchFloat(deps(rows, w))]);
    expect(sent).toHaveLength(1);
  });

  it("tries again when the transfer was refused before it was sent", async () => {
    const rows = [row()];
    let calls = 0;
    const { w } = wallet(50_000_000n, MIN_FLOAT_ETH_WEI, async () => {
      calls += 1;
      if (calls === 1) throw new FloatNotSent("simulation reverted");
      return "0xsecond";
    });
    expect(await dispatchFloat(deps(rows, w))).toEqual([{ payoutId: "po_1", outcome: "retry" }]);
    expect(rows[0]!.floatClaimedAt).toBeNull();
    expect(await dispatchFloat(deps(rows, w))).toEqual([{ payoutId: "po_1", outcome: "sent" }]);
    expect(rows[0]!.floatTxHash).toBe("0xsecond");
  });

  it("holds a transfer that may have been broadcast instead of risking a second one", async () => {
    const rows = [row()];
    const { w } = wallet(50_000_000n, MIN_FLOAT_ETH_WEI, async () => Promise.reject(new Error("timeout")));
    expect(await dispatchFloat(deps(rows, w))).toEqual([{ payoutId: "po_1", outcome: "unknown" }]);
    expect(await dispatchFloat(deps(rows, w))).toEqual([]);
    expect(rows[0]!.floatClaimedAt).toEqual(NOW);
  });

  it("ignores payouts that use the 1Click path or have already ended", async () => {
    const rows = [
      row({ id: "po_hop", floatTarget: null, floatUnits: null }),
      row({ id: "po_done", state: "settled" }),
    ];
    const { w, sent } = wallet(50_000_000n);
    expect(await dispatchFloat(deps(rows, w))).toEqual([]);
    expect(sent).toEqual([]);
  });
});
