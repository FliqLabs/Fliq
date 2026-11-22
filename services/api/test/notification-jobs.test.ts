import { describe, expect, it } from "vitest";
import { crossed, runNotificationJobs, startNotificationJobs, sundayWindow } from "../apps/api/src/notification-jobs.js";
import type { Unit } from "../apps/api/src/db.js";
import type { VaultClient } from "../packages/chains/vault/index.js";

describe("notification jobs", () => {
  it("alerts only for a rise through a positive threshold", () => {
    expect(crossed(1399, 1452, 1400)).toBe(true);
    expect(crossed(1401, 1452, 1400)).toBe(false);
    expect(crossed(1399, 1400, 1400)).toBe(false);
    expect(crossed(null, 1452, 1400)).toBe(false);
    expect(crossed(1399, null, 1400)).toBe(false);
  });

  it("summarizes the prior complete UTC week only on Sunday", () => {
    expect(sundayWindow(new Date("2026-11-23T00:00:00Z"))).toBeNull();
    expect(sundayWindow(new Date("2026-11-22T12:00:00Z"))).toEqual({
      start: new Date("2026-11-15T00:00:00Z"), end: new Date("2026-11-22T00:00:00Z"), key: "2026-11-22",
    });
  });

  it("stops scheduling and waits for an in-flight job before shutdown", async () => {
    let release: (() => void) | undefined;
    let calls = 0;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const stop = startNotificationJobs({
      unit: (async () => { calls++; await pending; return []; }) as unknown as Unit,
      vault: {} as VaultClient,
      send: async () => ({ status: 200 }),
      now: () => new Date("2026-11-23T12:00:00Z"),
      log: () => {},
    }, 1);
    let closed = false;
    const closing = stop().then(() => { closed = true; });
    expect(closed).toBe(false);
    release?.();
    await closing;
    expect(calls).toBe(2); // the one started job reads users and samples
  });

  it("sends a crossing and Sunday totals once, retries failed delivery, and excludes disabled users", async () => {
    const at = new Date("2026-11-22T12:00:00Z");
    const rows = new Map<string, { leaseUntil: Date | null; deliveredAt: Date | null }>();
    const sent: object[] = [];
    let fail = true;
    const db = {
      user: { findMany: async () => [
        { id: "u1", nearAccount: "one.near", notificationSettings: { rate_alert: { enabled: true, currency: "NGN", above: 1400 }, weekly_summary: true } },
        { id: "u2", nearAccount: "two.near", notificationSettings: { rate_alert: { enabled: false, currency: "NGN", above: 1400 }, weekly_summary: false } },
      ] },
      rateSample: { findMany: async () => [
        { sampledAt: new Date("2026-11-22T11:59:00Z"), rate: "1452" },
        { sampledAt: new Date("2026-11-22T11:58:00Z"), rate: "1399" },
      ] },
      transfer: { findMany: async () => [
        { fromUserId: "u2", toUserId: "u1", amount: 5_000_000n },
        { fromUserId: "u1", toUserId: "u2", amount: 2_000_000n },
      ] },
      pushToken: { findMany: async ({ where }: { where: { userId: string } }) => where.userId === "u1" ? [{ token: "device", environment: "sandbox", bundleId: "test", platform: "ios" }] : [] },
      notificationDelivery: {
        createMany: async ({ data }: { data: { messageId: string; token: string }[] }) => {
          const key = `${data[0]?.messageId}:${data[0]?.token}`;
          if (!rows.has(key)) rows.set(key, { leaseUntil: null, deliveredAt: null });
        },
        updateMany: async ({ where, data }: { where: { messageId: string; token: string; deliveredAt: null; leaseUntil?: Date; OR?: unknown }; data: { leaseUntil: Date | null; deliveredAt?: Date } }) => {
          const row = rows.get(`${where.messageId}:${where.token}`);
          if (!row || row.deliveredAt || (where.OR && row.leaseUntil && row.leaseUntil >= at) || (where.leaseUntil && row.leaseUntil?.getTime() !== where.leaseUntil.getTime())) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      },
    };
    const deps = {
      unit: (async (fn: (tx: typeof db) => Promise<unknown>) => fn(db)) as unknown as Unit,
      vault: { getBalance: async () => ({ available: 8_000_000n, reserved: 2_000_000n, total: 10_000_000n }) } as unknown as VaultClient,
      send: async (_target: unknown, payload: object) => { sent.push(payload); return { status: fail ? 503 : 200 }; },
      now: () => at,
      log: () => {},
    };
    expect(await runNotificationJobs(deps)).toBe(0);
    fail = false;
    expect(await runNotificationJobs(deps)).toBe(2);
    expect(await runNotificationJobs(deps)).toBe(0);
    expect(sent).toHaveLength(4);
    expect(JSON.stringify(sent)).toContain("In $5.00 · Out $2.00 · Balance $10.00");
  });
});
