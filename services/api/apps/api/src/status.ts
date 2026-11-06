import { newId } from "../../../packages/db/src/ids.js";
import type { Db, Unit } from "./db.js";

export type ComponentKind = "service" | "provider";
export type CheckOutcome = { result: "ok" | "degraded" | "down"; errorKind?: string };

export interface Probe {
  id: string;
  name: string;
  kind: ComponentKind;
  run(): Promise<CheckOutcome>;
}

export interface StatusConfig {
  probeTimeoutMs: number;
  // Answering, but slower than this, counts as degraded.
  degradedAfterMs: number;
  // Consecutive bad checks before an incident opens, and consecutive good ones before it closes.
  openAfter: number;
  closeAfter: number;
  // A result older than this no longer says how the component is doing now.
  staleAfterMs: number;
  days: number;
}

export const DEFAULT_STATUS_CONFIG: StatusConfig = { probeTimeoutMs: 5_000, degradedAfterMs: 3_000, openAfter: 3, closeAfter: 3, staleAfterMs: 5 * 60_000, days: 60 };

const wait = (ms: number) => new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms).unref?.());

async function measure(probe: Probe, config: StatusConfig): Promise<CheckOutcome & { latencyMs: number }> {
  const started = Date.now();
  try {
    const outcome = await Promise.race([probe.run(), wait(config.probeTimeoutMs)]);
    const latencyMs = Date.now() - started;
    return outcome.result === "ok" && latencyMs > config.degradedAfterMs ? { result: "degraded", errorKind: "slow", latencyMs } : { ...outcome, latencyMs };
  } catch (error) {
    return { result: "down", errorKind: (error as Error).message === "timeout" ? "timeout" : "error", latencyMs: Date.now() - started };
  }
}

// An incident has a fixed shape and no message from the failing component, which could carry account details.
async function updateIncident(tx: Db, probe: Probe, config: StatusConfig, now: Date): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`incident:${probe.id}`}, 0))`;
  const recent = await tx.healthCheck.findMany({
    where: { component: probe.id },
    orderBy: { checkedAt: "desc" },
    take: Math.max(config.openAfter, config.closeAfter),
  });
  const open = await tx.incident.findFirst({ where: { component: probe.id, state: "open" } });
  const bad = (rows: typeof recent, count: number) => rows.length >= count && rows.slice(0, count).every((row) => row.result !== "ok");
  const good = (rows: typeof recent, count: number) => rows.length >= count && rows.slice(0, count).every((row) => row.result === "ok");
  const impact = recent.slice(0, config.openAfter).some((row) => row.result === "down") ? "outage" : "degraded";

  if (!open && bad(recent, config.openAfter)) {
    await tx.incident.create({
      data: {
        id: newId("inc"),
        component: probe.id,
        title: impact === "outage" ? `${probe.name} is down` : `${probe.name} is degraded`,
        impact,
        summary: `${probe.name} failed ${config.openAfter} health checks in a row.`,
        startedAt: now,
      },
    });
    return;
  }
  if (open && good(recent, config.closeAfter)) {
    await tx.incident.update({ where: { id: open.id }, data: { state: "resolved", resolvedAt: now } });
    return;
  }
  if (open && open.impact === "degraded" && recent[0]?.result === "down") {
    await tx.incident.update({ where: { id: open.id }, data: { impact: "outage", title: `${probe.name} is down` } });
  }
}

export async function runHealthChecks(unit: Unit, probes: readonly Probe[], config: StatusConfig = DEFAULT_STATUS_CONFIG, now: () => Date = () => new Date()): Promise<void> {
  const outcomes = await Promise.all(probes.map(async (probe) => ({ probe, outcome: await measure(probe, config) })));
  for (const { probe, outcome } of outcomes) {
    await unit(async (tx) => {
      await tx.healthCheck.create({
        data: { id: newId("hc"), component: probe.id, checkedAt: now(), result: outcome.result, latencyMs: outcome.latencyMs, errorKind: outcome.errorKind ?? null },
      });
      await updateIncident(tx, probe, config, now());
    });
  }
}

// Checks run on a timer, never overlapping themselves, and a failed run is logged without stopping the next one.
export function startHealthChecks(unit: Unit, probes: readonly Probe[], intervalMs = 60_000, config: StatusConfig = DEFAULT_STATUS_CONFIG): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runHealthChecks(unit, probes, config);
    } catch (error) {
      console.error("[status] health check run failed", (error as Error).name);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

export type DayStatus = "operational" | "degraded" | "outage" | "no_data";

// A day is an outage when 5% or more of its checks failed, degraded when any check was not clean, else operational.
export function dayStatus(counts: { ok: number; degraded: number; down: number }): DayStatus {
  const total = counts.ok + counts.degraded + counts.down;
  if (total === 0) return "no_data";
  if (counts.down / total >= 0.05) return "outage";
  return counts.degraded + counts.down > 0 ? "degraded" : "operational";
}

const dayKey = (date: Date) => date.toISOString().slice(0, 10);

// Days are UTC calendar days, oldest first, ending today. Every component gets every day, with no_data where nothing ran.
export async function statusReport(tx: Db, probes: readonly Probe[], config: StatusConfig, now: Date) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const first = new Date(today.getTime() - (config.days - 1) * 86_400_000);
  const rows = await tx.$queryRaw<{ component: string; day: string; ok: number; degraded: number; down: number }[]>`
    SELECT component,
           to_char(date_trunc('day', checked_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
           count(*) FILTER (WHERE result = 'ok')::int AS ok,
           count(*) FILTER (WHERE result = 'degraded')::int AS degraded,
           count(*) FILTER (WHERE result = 'down')::int AS down
    FROM status.health_checks
    WHERE checked_at >= ${first}
    GROUP BY 1, 2`;
  const byKey = new Map(rows.map((row) => [`${row.component}:${row.day}`, row]));
  const latest = await Promise.all(probes.map((probe) => tx.healthCheck.findFirst({ where: { component: probe.id }, orderBy: { checkedAt: "desc" } })));

  const components = probes.map((probe, index) => {
    const last = latest[index];
    const fresh = last && now.getTime() - last.checkedAt.getTime() <= config.staleAfterMs;
    return {
      id: probe.id,
      name: probe.name,
      kind: probe.kind,
      state: fresh ? ({ ok: "healthy", degraded: "degraded", down: "down" } as const)[last.result] : ("unknown" as const),
      days: Array.from({ length: config.days }, (_, offset) => {
        const date = dayKey(new Date(first.getTime() + offset * 86_400_000));
        const counts = byKey.get(`${probe.id}:${date}`) ?? { ok: 0, degraded: 0, down: 0 };
        const total = counts.ok + counts.degraded + counts.down;
        return {
          date,
          status: dayStatus(counts),
          checks: total,
          uptime_percent: total === 0 ? null : Math.round(((counts.ok + counts.degraded) / total) * 10_000) / 100,
        };
      }),
    };
  });

  // Only incidents of components the page shows, so a retired component's history does not appear.
  const incidents = await tx.incident.findMany({
    where: { startedAt: { gte: first }, component: { in: probes.map((probe) => probe.id) } },
    orderBy: { startedAt: "desc" },
    take: 100,
  });
  return {
    updated_at: now.toISOString(),
    components,
    incidents: incidents.map((incident) => ({
      incident_id: incident.id,
      component: incident.component,
      title: incident.title,
      impact: incident.impact,
      state: incident.state,
      summary: incident.summary,
      started_at: incident.startedAt.toISOString(),
      resolved_at: incident.resolvedAt?.toISOString() ?? null,
    })),
  };
}
