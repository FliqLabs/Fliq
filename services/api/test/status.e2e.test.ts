import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockProvisioner } from "../apps/api/src/accounts.js";
import { buildApp } from "../apps/api/src/app.js";
import { loadConfig } from "../apps/api/src/config.js";
import { createDatabase, unitOf } from "../apps/api/src/db.js";
import { createHandlers } from "../apps/api/src/handlers.js";
import { DEFAULT_VELOCITY } from "../apps/api/src/payouts.js";
import { sandboxAdapters } from "../apps/api/src/sandbox.js";
import { DEFAULT_STATUS_CONFIG, dayStatus, runHealthChecks, type CheckOutcome, type Probe } from "../apps/api/src/status.js";
import { MockVault } from "../packages/chains/vault/index.js";
import { newId } from "../packages/db/src/ids.js";
import { DEFAULT_ROUTING_CONFIG, NO_SIGNALS } from "../packages/domain/routing.js";

// Throwaway local database only; Prisma loads .env, which may point at a shared one.
const enabled = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") && Boolean(process.env.FLIQ_ACCESS_SECRET);
const NOW = new Date("2026-11-05T14:30:00Z");
const MINUTE = 60_000;

describe("day classification", () => {
  it("calls a day by how many checks failed", () => {
    expect(dayStatus({ ok: 0, degraded: 0, down: 0 })).toBe("no_data");
    expect(dayStatus({ ok: 1440, degraded: 0, down: 0 })).toBe("operational");
    expect(dayStatus({ ok: 1439, degraded: 1, down: 0 })).toBe("degraded");
    expect(dayStatus({ ok: 1439, degraded: 0, down: 1 })).toBe("degraded");
    expect(dayStatus({ ok: 95, degraded: 0, down: 5 })).toBe("outage");
    expect(dayStatus({ ok: 96, degraded: 0, down: 4 })).toBe("degraded");
  });
});

describe.skipIf(!enabled)("health checks, incidents and the status report", () => {
  if (!enabled) {
    it("needs DATABASE_URL pointing at a local database", () => {});
    return;
  }

  const database = createDatabase();
  const unit = unitOf(database);
  const config = loadConfig();
  const suffix = randomBytes(3).toString("hex");
  const id = (name: string) => `${name}-${suffix}`;
  const components: string[] = [];

  const probeOf = (name: string, behave: () => Promise<CheckOutcome>): Probe => {
    components.push(id(name));
    return { id: id(name), name: name.toUpperCase(), kind: "provider", run: behave };
  };
  const tight = { ...DEFAULT_STATUS_CONFIG, probeTimeoutMs: 80, degradedAfterMs: 40 };
  let clock = NOW.getTime();
  const step = () => new Date((clock += MINUTE));
  const run = (probes: Probe[]) => runHealthChecks(unit, probes, tight, step);
  const rows = (component: string) => database.healthCheck.findMany({ where: { component }, orderBy: { checkedAt: "asc" } });
  const incidents = (component: string) => database.incident.findMany({ where: { component }, orderBy: { startedAt: "asc" } });

  const app = buildApp({
    config,
    unit,
    handlers: createHandlers({
      config,
      unit,
      email: { sendSignInLink: async () => undefined },
      provisioner: new MockProvisioner(config.vaultAccount),
      vault: new MockVault({ registrar: "registrar.test.near", usdc: "usdc.test.near", now: () => 0n }),
      quotes: { adapters: sandboxAdapters(), routing: DEFAULT_ROUTING_CONFIG, signals: NO_SIGNALS, now: () => NOW },
      payouts: { config, adapters: sandboxAdapters(), velocity: DEFAULT_VELOCITY, now: () => NOW },
      status: { probes: [], config: DEFAULT_STATUS_CONFIG },
      now: () => NOW,
    }),
  });

  beforeAll(() => app.ready(), 60_000);
  afterAll(async () => {
    await database.$transaction(async (tx) => {
      await tx.healthCheck.deleteMany({ where: { component: { in: components } } });
      await tx.incident.deleteMany({ where: { component: { in: components } } });
    });
    await database.$disconnect();
  }, 60_000);

  it("records one row per probe and maps outcomes without storing error messages", async () => {
    const good = probeOf("good", async () => ({ result: "ok" }));
    const broken = probeOf("broken", async () => Promise.reject(new Error("account 0123456789 leaked")));
    const hung = probeOf("hung", () => new Promise(() => undefined));
    const slow = probeOf("slow", async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return { result: "ok" };
    });
    await run([good, broken, hung, slow]);

    expect((await rows(good.id))[0]).toMatchObject({ result: "ok", errorKind: null });
    expect((await rows(broken.id))[0]).toMatchObject({ result: "down", errorKind: "error" });
    expect((await rows(hung.id))[0]).toMatchObject({ result: "down", errorKind: "timeout" });
    expect((await rows(slow.id))[0]).toMatchObject({ result: "degraded", errorKind: "slow" });
    expect(JSON.stringify(await rows(broken.id))).not.toContain("0123456789");
    expect((await rows(good.id))[0]?.latencyMs).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it("opens one incident after three bad checks in a row, escalates it, and closes it after three clean ones", async () => {
    let next: CheckOutcome = { result: "ok" };
    const probe = probeOf("flaky", async () => next);
    const set = async (outcome: CheckOutcome) => {
      next = outcome;
      await run([probe]);
    };

    await set({ result: "degraded" });
    await set({ result: "degraded" });
    expect(await incidents(probe.id)).toEqual([]);
    await set({ result: "degraded" });
    const [opened] = await incidents(probe.id);
    expect(opened).toMatchObject({ impact: "degraded", state: "open", resolvedAt: null, title: "FLAKY is degraded" });
    expect(opened?.summary).not.toMatch(/\d{6,}/);

    await set({ result: "down" });
    expect(await incidents(probe.id)).toHaveLength(1);
    expect((await incidents(probe.id))[0]).toMatchObject({ impact: "outage", title: "FLAKY is down", state: "open" });

    await set({ result: "ok" });
    await set({ result: "ok" });
    expect((await incidents(probe.id))[0]?.state).toBe("open");
    await set({ result: "down" });
    await set({ result: "ok" });
    await set({ result: "ok" });
    expect((await incidents(probe.id))[0]?.state).toBe("open");
    await set({ result: "ok" });
    const [closed] = await incidents(probe.id);
    expect(closed).toMatchObject({ state: "resolved" });
    expect(closed?.resolvedAt).not.toBeNull();

    for (let attempt = 0; attempt < 3; attempt++) await set({ result: "down" });
    expect(await incidents(probe.id)).toHaveLength(2);
  }, 120_000);

  it("never opens two incidents for one component when checks overlap", async () => {
    const probe = probeOf("racy", async () => ({ result: "down" }));
    await run([probe]);
    await run([probe]);
    await Promise.all(Array.from({ length: 10 }, () => run([probe])));
    expect(await incidents(probe.id)).toHaveLength(1);
  }, 120_000);

  it("serves 60 days per component, publicly and cacheable", async () => {
    const mixed = probeOf("report", async () => ({ result: "ok" }));
    const quiet = probeOf("quiet", async () => ({ result: "ok" }));
    const stale = probeOf("stale", async () => ({ result: "ok" }));
    const at = (daysAgo: number, minute = 0) => new Date(Date.UTC(2026, 10, 5 - daysAgo, 10, minute));
    const seed = (component: string, daysAgo: number, result: "ok" | "degraded" | "down", count: number) =>
      database.healthCheck.createMany({
        data: Array.from({ length: count }, (_, minute) => ({ id: newId("hc"), component, checkedAt: at(daysAgo, minute), result })),
      });
    await seed(mixed.id, 2, "ok", 100);
    await seed(mixed.id, 1, "ok", 90);
    await seed(mixed.id, 1, "down", 10);
    await seed(mixed.id, 0, "ok", 99);
    await seed(mixed.id, 0, "degraded", 1);
    await database.healthCheck.create({ data: { id: newId("hc"), component: mixed.id, checkedAt: new Date(NOW.getTime() - MINUTE), result: "ok" } });
    await database.healthCheck.create({ data: { id: newId("hc"), component: stale.id, checkedAt: new Date(NOW.getTime() - 10 * MINUTE), result: "ok" } });
    await database.incident.create({
      data: { id: newId("inc"), component: mixed.id, title: "REPORT is down", impact: "outage", state: "resolved", summary: "x", startedAt: new Date("2026-11-03T09:00:00Z"), resolvedAt: new Date("2026-11-03T10:00:00Z") },
    });
    await database.incident.create({
      data: { id: newId("inc"), component: mixed.id, title: "REPORT is degraded", impact: "degraded", state: "open", summary: "y", startedAt: new Date("2026-11-05T13:00:00Z") },
    });
    await database.incident.create({
      data: { id: newId("inc"), component: mixed.id, title: "too old", impact: "outage", state: "resolved", summary: "z", startedAt: new Date("2026-08-01T00:00:00Z"), resolvedAt: new Date("2026-08-01T01:00:00Z") },
    });

    const reporting = buildApp({
      config,
      unit,
      handlers: createHandlers({
        config,
        unit,
        email: { sendSignInLink: async () => undefined },
        provisioner: new MockProvisioner(config.vaultAccount),
        vault: new MockVault({ registrar: "registrar.test.near", usdc: "usdc.test.near", now: () => 0n }),
        quotes: { adapters: sandboxAdapters(), routing: DEFAULT_ROUTING_CONFIG, signals: NO_SIGNALS, now: () => NOW },
        payouts: { config, adapters: sandboxAdapters(), velocity: DEFAULT_VELOCITY, now: () => NOW },
        status: { probes: [mixed, quiet, stale] },
        now: () => NOW,
      }),
    });
    const reply = await reporting.inject({ method: "GET", url: "/v1/status" });
    expect(reply.statusCode).toBe(200);
    expect(reply.headers["cache-control"]).toBe("public, max-age=10");
    const report = reply.json();
    expect(report.updated_at).toBe(NOW.toISOString());

    const component = (name: string) => report.components.find((entry: { id: string }) => entry.id === name);
    const days = component(mixed.id).days;
    expect(days).toHaveLength(60);
    expect(days[0].date).toBe("2026-09-07");
    expect(days.at(-1).date).toBe("2026-11-05");
    expect(days.at(-3)).toEqual({ date: "2026-11-03", status: "operational", checks: 100, uptime_percent: 100 });
    expect(days.at(-2)).toEqual({ date: "2026-11-04", status: "outage", checks: 100, uptime_percent: 90 });
    expect(days.at(-1)).toMatchObject({ date: "2026-11-05", status: "degraded", checks: 101 });
    expect(days[0]).toEqual({ date: "2026-09-07", status: "no_data", checks: 0, uptime_percent: null });
    expect(component(mixed.id).state).toBe("healthy");
    expect(component(stale.id).state).toBe("unknown");
    expect(component(quiet.id)).toMatchObject({ state: "unknown", kind: "provider" });
    expect(component(quiet.id).days.every((day: { status: string }) => day.status === "no_data")).toBe(true);

    expect(report.incidents.map((incident: { title: string }) => incident.title)).toEqual(["REPORT is degraded", "REPORT is down"]);
    expect(report.incidents[0]).toMatchObject({ state: "open", resolved_at: null });
    expect(report.incidents[1].resolved_at).toBe("2026-11-03T10:00:00.000Z");
  }, 120_000);
});
