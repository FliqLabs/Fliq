import type { VaultClient } from "../../../packages/chains/vault/index.js";
import type { Unit } from "./db.js";
import { apnsPayload, type PushSender } from "./push.js";
import { DEFAULT_NOTIFICATIONS, type NotificationSettings } from "./settings.js";

const DAY_MS = 86_400_000;
export const crossed = (previous: number | null, current: number | null, above: number) =>
  previous !== null && current !== null && [previous, current, above].every(Number.isFinite) && above > 0 && previous <= above && current > above;

export function sundayWindow(now: Date) {
  if (now.getUTCDay() !== 0) return null;
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { start: new Date(end.getTime() - 7 * DAY_MS), end, key: end.toISOString().slice(0, 10) };
}

export type JobDeps = { unit: Unit; vault: VaultClient; send: PushSender | null; now: () => Date; log: (message: string) => void };
type Message = { key: string; kind: "rate_alert" | "weekly_summary"; title: string; body: string };
const dollars = (units: bigint) => {
  const cents = (units + 5_000n) / 10_000n;
  return `$${(cents / 100n).toLocaleString("en-US")}.${(cents % 100n).toString().padStart(2, "0")}`;
};

async function deliver(deps: JobDeps, userId: string, message: Message): Promise<number> {
  if (!deps.send) return 0;
  const targets = await deps.unit((tx) => tx.pushToken.findMany({ where: { userId, platform: "ios" } }));
  let sent = 0;
  for (const target of targets) {
    const lease = new Date(deps.now().getTime() + 45_000);
    const claimed = await deps.unit(async (tx) => {
      await tx.notificationDelivery.createMany({ data: [{ messageId: message.key, token: target.token }], skipDuplicates: true });
      return (await tx.notificationDelivery.updateMany({
        where: { messageId: message.key, token: target.token, deliveredAt: null, OR: [{ leaseUntil: null }, { leaseUntil: { lt: deps.now() } }] },
        data: { leaseUntil: lease },
      })).count === 1;
    });
    if (!claimed) continue;
    const result = await deps.send(target, apnsPayload({ title: message.title, body: message.body, kind: message.kind, refId: message.key })).catch(() => ({ status: 0 }));
    await deps.unit((tx) => tx.notificationDelivery.updateMany({
      where: { messageId: message.key, token: target.token, leaseUntil: lease, deliveredAt: null },
      data: { leaseUntil: null, ...(result.status === 200 ? { deliveredAt: deps.now() } : {}) },
    }));
    if (result.status === 200) sent++;
    else deps.log(`notification delivery failed: ${result.status}`);
  }
  return sent;
}

export async function runNotificationJobs(deps: JobDeps): Promise<number> {
  if (!deps.send) return 0;
  const at = deps.now();
  const window = sundayWindow(at);
  const users = await deps.unit((tx) => tx.user.findMany({ select: { id: true, nearAccount: true, notificationSettings: true } }));
  const samples = await deps.unit((tx) => tx.rateSample.findMany({
    where: { token: "usdc", currency: "ngn", sampledAt: { gte: new Date(at.getTime() - 5 * 60_000), lte: at } },
    orderBy: { sampledAt: "desc" }, take: 100,
  }));
  const times = [...new Set(samples.map((sample) => sample.sampledAt.getTime()))];
  const best = (time: number | undefined) => {
    if (time === undefined) return null;
    const rates = samples.filter((sample) => sample.sampledAt.getTime() === time).map((sample) => Number(sample.rate)).filter(Number.isFinite);
    return rates.length ? Math.max(...rates) : null;
  };
  const previous = best(times[1]);
  const current = best(times[0]);
  let count = 0;
  for (const user of users) {
    const settings = { ...DEFAULT_NOTIFICATIONS, ...((user.notificationSettings ?? {}) as Partial<NotificationSettings>) };
    const alert = settings.rate_alert;
    if (alert?.enabled && alert.currency === "NGN" && alert.above && crossed(previous, current, alert.above)) {
      count += await deliver(deps, user.id, { key: `rate:${user.id}:${at.toISOString().slice(0, 10)}`, kind: "rate_alert", title: "Rate alert", body: `$1 = ₦${current?.toLocaleString("en-NG")} right now` });
    }
    if (!window || !settings.weekly_summary || !user.nearAccount) continue;
    const transfers = await deps.unit((tx) => tx.transfer.findMany({
      where: { asset: "USDC", createdAt: { gte: window.start, lt: window.end }, OR: [{ fromUserId: user.id }, { toUserId: user.id }] },
      select: { fromUserId: true, toUserId: true, amount: true },
    }));
    const incoming = transfers.reduce((sum, row) => sum + (row.toUserId === user.id ? row.amount : 0n), 0n);
    const outgoing = transfers.reduce((sum, row) => sum + (row.fromUserId === user.id ? row.amount : 0n), 0n);
    try {
      const balance = await deps.vault.getBalance(user.nearAccount);
      count += await deliver(deps, user.id, { key: `weekly:${user.id}:${window.key}`, kind: "weekly_summary", title: "Your weekly summary", body: `In ${dollars(incoming)} · Out ${dollars(outgoing)} · Balance ${dollars(balance.total)}` });
    } catch (error) { deps.log(`weekly balance unavailable: ${(error as Error).name}`); }
  }
  return count;
}

export function startNotificationJobs(deps: JobDeps, intervalMs = 60_000): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  let stopped = false;
  const tick = () => {
    if (stopped || inFlight) return;
    inFlight = runNotificationJobs(deps)
      .catch((error) => { deps.log(`notification job failed: ${(error as Error).name}`); })
      .then(() => { inFlight = null; });
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return async () => { stopped = true; clearInterval(timer); await inFlight; };
}
