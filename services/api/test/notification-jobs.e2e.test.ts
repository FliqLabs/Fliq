import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, unitOf } from "../apps/api/src/db.js";
import { runNotificationJobs } from "../apps/api/src/notification-jobs.js";
import type { VaultClient } from "../packages/chains/vault/index.js";

// Never run against a shared database. Requires the new migration on a local PostgreSQL instance.
const enabled = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "");

describe.skipIf(!enabled)("notification jobs with PostgreSQL", () => {
  if (!enabled) return;
  const database = createDatabase();
  const unit = unitOf(database);
  const id = randomUUID();
  const userId = `notification-${id}`;
  const peerId = `notification-peer-${id}`;
  const token = `notification-token-${id}`;
  const sampleIds = [`notification-sample-1-${id}`, `notification-sample-2-${id}`, `next-1-${id}`, `next-2-${id}`];
  let at = new Date("2026-11-22T12:00:00Z");
  const sent: object[] = [];
  let fail = false;

  beforeAll(async () => {
    await unit(async (tx) => {
      await tx.user.createMany({ data: [
        { id: userId, nearAccount: `${id}.near`, notificationSettings: { rate_alert: { enabled: true, currency: "NGN", above: 1400 }, weekly_summary: true } },
        { id: peerId, nearAccount: `${id}-peer.near`, notificationSettings: { rate_alert: { enabled: false, currency: "NGN", above: 1400 }, weekly_summary: false } },
      ] });
      await tx.pushToken.create({ data: { token, userId, platform: "ios", environment: "sandbox" } });
      await tx.rateSample.createMany({ data: sampleIds.slice(0, 2).map((sampleId, index) => ({
        id: sampleId, token: "usdc", currency: "ngn", provider: "test", rate: index ? "1452" : "1399",
        rateBeforeFees: index ? "1455" : "1402", feeMinor: 300n, receiveMinor: 1n, etaSeconds: 30,
        onTimePercent: 100, sampledAt: new Date(`2026-11-22T11:${index ? "59" : "58"}:00Z`),
      })) });
      await tx.transfer.createMany({ data: [
        { id: `incoming-${id}`, txHash: `incoming-${id}`, fromUserId: peerId, toUserId: userId, fromAccount: `${id}-peer.near`, toAccount: `${id}.near`, asset: "USDC", amount: 5_000_000n, createdAt: new Date("2026-11-20T12:00:00Z") },
        { id: `outgoing-${id}`, txHash: `outgoing-${id}`, fromUserId: userId, toUserId: peerId, fromAccount: `${id}.near`, toAccount: `${id}-peer.near`, asset: "USDC", amount: 2_000_000n, createdAt: new Date("2026-11-21T12:00:00Z") },
      ] });
    });
  });

  afterAll(async () => {
    await unit(async (tx) => {
      await tx.notificationDelivery.deleteMany({ where: { token } });
      await tx.pushToken.delete({ where: { token } });
      await tx.transfer.deleteMany({ where: { id: { in: [`incoming-${id}`, `outgoing-${id}`] } } });
      await tx.rateSample.deleteMany({ where: { id: { in: sampleIds } } });
      await tx.user.deleteMany({ where: { id: { in: [userId, peerId] } } });
    });
    await database.$disconnect();
  });

  const deps = {
    unit,
    vault: { getBalance: async () => ({ available: 8_000_000n, reserved: 2_000_000n, total: 10_000_000n }) } as unknown as VaultClient,
    send: async (_target: unknown, payload: object) => { sent.push(payload); return { status: fail ? 503 : 200 }; },
    now: () => at,
    log: () => {},
  };

  it("retries failed APNs responses and deduplicates simultaneous API instances", async () => {
    fail = true;
    expect(await runNotificationJobs(deps)).toBe(0);
    expect(await unit((tx) => tx.notificationDelivery.count({ where: { token, deliveredAt: { not: null } } }))).toBe(0);
    fail = false;
    const results = await Promise.all([runNotificationJobs(deps), runNotificationJobs(deps)]);
    expect(results.reduce((sum, count) => sum + count, 0)).toBe(2);
    expect(await runNotificationJobs(deps)).toBe(0);
    expect(await unit((tx) => tx.notificationDelivery.count({ where: { token, deliveredAt: { not: null } } }))).toBe(2);
    expect(JSON.stringify(sent)).toContain("In $5.00 · Out $2.00 · Balance $10.00");
  });

  it("uses a new daily key after restart and respects disabled alerts and summaries", async () => {
    at = new Date("2026-11-23T12:00:00Z");
    await unit((tx) => tx.rateSample.createMany({ data: [
      { id: `next-1-${id}`, token: "usdc", currency: "ngn", provider: "test", rate: "1399", rateBeforeFees: "1402", feeMinor: 300n, receiveMinor: 1n, etaSeconds: 30, onTimePercent: 100, sampledAt: new Date("2026-11-23T11:58:00Z") },
      { id: `next-2-${id}`, token: "usdc", currency: "ngn", provider: "test", rate: "1452", rateBeforeFees: "1455", feeMinor: 300n, receiveMinor: 1n, etaSeconds: 30, onTimePercent: 100, sampledAt: new Date("2026-11-23T11:59:00Z") },
    ] }));
    const restarted = { ...deps };
    expect(await runNotificationJobs(restarted)).toBe(1);
    expect(await runNotificationJobs(deps)).toBe(0);
    await unit((tx) => tx.user.update({ where: { id: userId }, data: { notificationSettings: { rate_alert: { enabled: false, currency: "NGN", above: 1400 }, weekly_summary: false } } }));
    at = new Date("2026-11-24T12:00:00Z");
    expect(await runNotificationJobs(restarted)).toBe(0);
    expect(await unit((tx) => tx.notificationDelivery.count({ where: { token, deliveredAt: { not: null } } }))).toBe(3);
  });
});
