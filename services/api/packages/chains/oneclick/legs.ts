import type { CallOptions, OneClickClient } from "./client";
import { OneClickError, TERMINAL_STATUSES, type OneClickExecution, type OneClickStatus } from "./types";

export const ACTIVE_POLL_MS = 5_000;
export const SLOW_POLL_MS = 60_000;
export const SLOW_AFTER_MS = 10 * 60_000;
export const HOLD_ALERT_AFTER_MS = 15 * 60_000;

const HOLDABLE: ReadonlySet<OneClickStatus> = new Set(["KNOWN_DEPOSIT_TX", "PROCESSING"]);

// What a 1Click status means for the payout (§10.2). The orchestrator owns the actual transition.
export type LegSignal =
  | "none"
  | "deposit_seen"
  | "underpaid"
  | "routing"
  | "delivered"
  | "refunded"
  | "failed";

const SIGNALS: Record<OneClickStatus, LegSignal> = {
  PENDING_DEPOSIT: "none",
  KNOWN_DEPOSIT_TX: "deposit_seen",
  INCOMPLETE_DEPOSIT: "underpaid",
  PROCESSING: "routing",
  SUCCESS: "delivered",
  REFUNDED: "refunded",
  FAILED: "failed",
};

export function legSignal(status: OneClickStatus): LegSignal {
  return SIGNALS[status];
}

export type LegState = {
  depositAddress: string;
  depositMemo: string | undefined;
  startedAt: Date;
  status: OneClickStatus | null;
  statusSince: Date | null;
  held: boolean;
};

export type LegAlert =
  | { kind: "held"; depositAddress: string; status: OneClickStatus; minutes: number }
  | { kind: "unreadable_status"; depositAddress: string; detail: string }
  | { kind: "terminal_changed"; depositAddress: string; from: OneClickStatus; to: OneClickStatus };

export type LegStep = { state: LegState; changed: boolean; alerts: LegAlert[] };

export function startLeg(depositAddress: string, depositMemo: string | undefined, now: Date): LegState {
  return { depositAddress, depositMemo, startedAt: now, status: null, statusSince: null, held: false };
}

export function isTerminal(state: LegState): boolean {
  return state.status !== null && TERMINAL_STATUSES.has(state.status);
}

export function nextPollAt(state: LegState, now: Date): Date | null {
  if (isTerminal(state)) return null;
  const age = now.getTime() - state.startedAt.getTime();
  return new Date(now.getTime() + (age < SLOW_AFTER_MS ? ACTIVE_POLL_MS : SLOW_POLL_MS));
}

// Terminal is terminal: a different answer after one is an anomaly for reconciliation, not a new state.
export function applyStatus(state: LegState, status: OneClickStatus, now: Date): LegStep {
  if (isTerminal(state)) {
    const alerts: LegAlert[] =
      state.status === status
        ? []
        : [
            {
              kind: "terminal_changed",
              depositAddress: state.depositAddress,
              from: state.status!,
              to: status,
            },
          ];
    return { state, changed: false, alerts };
  }
  const changed = status !== state.status;
  const statusSince = changed ? now : (state.statusSince ?? now);
  const stuckFor = now.getTime() - statusSince.getTime();
  const held = HOLDABLE.has(status) && stuckFor >= HOLD_ALERT_AFTER_MS;
  const alerts: LegAlert[] =
    held && !state.held
      ? [
          {
            kind: "held",
            depositAddress: state.depositAddress,
            status,
            minutes: Math.floor(stuckFor / 60_000),
          },
        ]
      : [];
  return { state: { ...state, status, statusSince, held }, changed, alerts };
}

export type PollOutcome = LegStep & {
  execution: OneClickExecution | undefined;
  error: OneClickError | undefined;
  nextPollAt: Date | null;
};

// A timeout, outage or unreadable answer leaves the leg exactly as it was: unknown is never treated as failed.
export async function pollLeg(
  client: OneClickClient,
  state: LegState,
  now: () => Date,
  options: CallOptions = {},
): Promise<PollOutcome> {
  try {
    const execution = await client.status(state.depositAddress, state.depositMemo, options);
    const at = now();
    const step = applyStatus(state, execution.status, at);
    return { ...step, execution, error: undefined, nextPollAt: nextPollAt(step.state, at) };
  } catch (error) {
    if (!(error instanceof OneClickError) || error.kind === "cancelled") throw error;
    const at = now();
    const alerts: LegAlert[] =
      error.kind === "invalid_response" || error.kind === "rejected"
        ? [{ kind: "unreadable_status", depositAddress: state.depositAddress, detail: error.message }]
        : [];
    return { state, changed: false, alerts, execution: undefined, error, nextPollAt: nextPollAt(state, at) };
  }
}
