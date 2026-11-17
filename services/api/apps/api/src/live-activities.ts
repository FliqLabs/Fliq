import type { Db, Unit } from "./db.js";
import { notFound } from "./errors.js";
import { isDeadToken, type PushSender, type SendResult } from "./push.js";

export type LiveActivityKind = "deposit" | "payout";

export type LiveActivityInput = {
  token: string;
  kind: LiveActivityKind;
  ref_id: string;
  environment: string;
  bundle_id: string;
};

export interface ContentState {
  step: number;
  steps: number;
  status: string;
  done: boolean;
  failed: boolean;
}

export interface ActivityState {
  content: ContentState;
  final: boolean;
}

const STEPS = 3;
// A deposit or cash-out still moving after this long is stuck, so its Live Activity is ended rather than kept.
const MAX_AGE_MS = 3 * 60 * 60_000;
const DISMISS_AFTER_SECONDS = 15 * 60;
const BATCH = 100;

const CHAIN_NAMES: Record<string, string> = { near: "NEAR", bnb: "BNB Chain" };

export const chainName = (chain: string) => CHAIN_NAMES[chain] ?? `${chain.charAt(0).toUpperCase()}${chain.slice(1)}`;

const state = (step: number, status: string, flags: { done?: boolean; failed?: boolean; final?: boolean } = {}): ActivityState => ({
  content: { step, steps: STEPS, status, done: flags.done ?? false, failed: flags.failed ?? false },
  final: flags.final ?? Boolean(flags.done),
});

export function depositActivityState(deposit: { state: string; chain: string; seenAt: Date | null; bridgingAt: Date | null }): ActivityState {
  const reached = deposit.bridgingAt ? 2 : deposit.seenAt ? 1 : 0;
  const failed = (status: string, step = reached) => state(step, status, { failed: true, final: true });
  switch (deposit.state) {
    case "seen":
      return state(1, `Seen on ${chainName(deposit.chain)}`);
    case "bridging":
      return state(2, "Moving to your vault");
    case "landed":
      return state(3, "In your vault", { done: true });
    case "underpaid":
      return failed("Too little sent", Math.max(reached, 1));
    case "refunded":
      return failed("Refunded");
    case "expired":
      return failed("Nothing arrived");
    case "failed":
      return failed("Didn't arrive");
    default:
      return state(0, "Waiting for it");
  }
}

export function payoutActivityState(payout: { state: string }): ActivityState {
  switch (payout.state) {
    case "deposit_seen":
    case "routing":
      return state(1, "On its way to the bank");
    case "with_provider":
    case "paying_out":
      return state(2, "The bank is paying");
    case "settled":
      return state(3, "Paid out", { done: true });
    case "refunding":
      return state(2, "Refunding", { failed: true });
    case "refunded":
      return state(2, "Refunded to your vault", { failed: true, final: true });
    case "expired":
    case "failed":
      return state(0, "Not paid", { failed: true, final: true });
    default:
      return state(0, "Sending");
  }
}

export function liveActivityPayload(content: ContentState, nowSeconds: number, end = false) {
  return {
    aps: {
      timestamp: nowSeconds,
      event: end ? "end" : "update",
      "content-state": content,
      ...(end ? { "dismissal-date": nowSeconds + DISMISS_AFTER_SECONDS } : {}),
    },
  };
}

// The iPhone gets a new token for each Live Activity, so registering one again only refreshes what it follows.
export async function registerLiveActivity(tx: Db, userId: string, input: LiveActivityInput): Promise<void> {
  const owned =
    input.kind === "deposit"
      ? await tx.vaultDeposit.findFirst({ where: { id: input.ref_id, userId }, select: { id: true } })
      : await tx.payout.findFirst({ where: { id: input.ref_id, recipient: { userId } }, select: { id: true } });
  if (!owned) throw notFound(input.kind === "deposit" ? "No such deposit." : "No such cash out.");
  const token = input.token.toLowerCase();
  const fields = { userId, kind: input.kind, refId: input.ref_id, environment: input.environment, bundleId: input.bundle_id };
  await tx.liveActivity.upsert({
    where: { token },
    create: { token, ...fields },
    update: { ...fields, lastSent: null, endedAt: null },
  });
}

async function currentState(tx: Db, activity: { kind: string; refId: string }): Promise<ActivityState | null> {
  if (activity.kind === "deposit") {
    const deposit = await tx.vaultDeposit.findUnique({
      where: { id: activity.refId },
      select: { state: true, chain: true, seenAt: true, bridgingAt: true },
    });
    return deposit ? depositActivityState(deposit) : null;
  }
  const payout = await tx.payout.findUnique({ where: { id: activity.refId }, select: { state: true } });
  return payout ? payoutActivityState(payout) : null;
}

export interface LiveActivityDeps {
  unit: Unit;
  send: PushSender | null;
  now: () => Date;
  log: (message: string) => void;
}

// Each change is claimed by a compare-and-set on last_sent before it is sent, so two API replicas never both push it.
export async function dispatchLiveActivities(deps: LiveActivityDeps): Promise<number> {
  const send = deps.send;
  if (!send) return 0;
  const now = deps.now();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const activities = await deps.unit((tx) =>
    tx.liveActivity.findMany({ where: { endedAt: null }, orderBy: { createdAt: "asc" }, take: BATCH }),
  );
  let sent = 0;
  for (const activity of activities) {
    const current = await deps.unit((tx) => currentState(tx, activity));
    const stale = now.getTime() - activity.createdAt.getTime() > MAX_AGE_MS;
    if (!current) {
      await deps.unit((tx) => tx.liveActivity.updateMany({ where: { token: activity.token, endedAt: null }, data: { endedAt: now } }));
      continue;
    }
    const json = JSON.stringify(current.content);
    const end = current.final || stale;
    if (json === activity.lastSent && !end) continue;
    const claimed = await deps.unit((tx) =>
      tx.liveActivity.updateMany({
        where: { token: activity.token, endedAt: null, lastSent: activity.lastSent },
        data: { lastSent: json, ...(end ? { endedAt: now } : {}) },
      }),
    );
    if (claimed.count === 0) continue;
    const target = { token: activity.token, environment: activity.environment, bundleId: activity.bundleId, pushType: "liveactivity" as const };
    const result = await send(target, liveActivityPayload(current.content, nowSeconds, end)).catch(
      () => ({ status: 0, reason: "SendFailed" }) as SendResult,
    );
    if (result.status === 200) sent += 1;
    else if (isDeadToken(result)) await deps.unit((tx) => tx.liveActivity.deleteMany({ where: { token: activity.token } }));
    else {
      deps.log(`live activity push failed: ${result.status} ${result.reason ?? ""}`.trim());
      if (stale) continue;
      await deps.unit((tx) =>
        tx.liveActivity.updateMany({ where: { token: activity.token, lastSent: json }, data: { lastSent: activity.lastSent, endedAt: null } }),
      );
    }
  }
  return sent;
}

export function startLiveActivityDispatch(deps: LiveActivityDeps, intervalMs: number) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await dispatchLiveActivities(deps);
    } catch (error) {
      deps.log(`live activity tick failed: ${(error as Error).name}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
