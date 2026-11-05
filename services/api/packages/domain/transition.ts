import type { Prisma } from "@prisma/client";
import { newId } from "../db/src/ids.js";
import { plan, type PayoutState } from "./payout-state.js";

type Db = Prisma.TransactionClient;

export interface TransitionRequest {
  payoutId: string;
  target: PayoutState;
  cause: string;
  detail?: Prisma.InputJsonObject;
  traceId?: string;
}

export interface Step {
  payoutId: string;
  from: PayoutState;
  to: PayoutState;
  version: number;
  backfilled: boolean;
}

export type TransitionResult =
  | { outcome: "advanced"; state: PayoutState; version: number; steps: Step[] }
  | { outcome: "duplicate" | "stale" | "late_signal" | "illegal"; state: PayoutState };

// Runs once per recorded step, inside the transition's transaction: the ledger posting and the outbox message go here.
export type StepEffect = (tx: Db, step: Step) => Promise<void>;

const MAX_ATTEMPTS = 5;

// Spec 5.2: a transition is an UPDATE guarded by the version we read. When another writer got there first,
// zero rows change and we re-read and re-plan instead of overwriting.
export async function transitionPayout(tx: Db, request: TransitionRequest, effect?: StepEffect): Promise<TransitionResult> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const payout = await tx.payout.findUniqueOrThrow({ where: { id: request.payoutId } });
    const current = payout.state as PayoutState;
    const decision = plan(current, request.target, payout.routeKind);
    if (decision.kind !== "advance") return { outcome: decision.kind, state: current };

    const version = payout.version + decision.steps.length;
    const claimed = await tx.payout.updateMany({
      where: { id: payout.id, version: payout.version },
      data: { state: request.target, version, updatedAt: new Date() },
    });
    if (claimed.count === 0) continue;

    let from = current;
    const steps: Step[] = [];
    for (const [index, to] of decision.steps.entries()) {
      const step: Step = {
        payoutId: payout.id,
        from,
        to,
        version: payout.version + index + 1,
        backfilled: to !== request.target,
      };
      await tx.payoutEvent.create({
        data: {
          id: newId("pev"),
          payoutId: payout.id,
          fromState: from,
          toState: to,
          version: step.version,
          cause: step.backfilled ? `backfilled:${request.cause}` : request.cause,
          detail: request.detail ?? {},
          traceId: request.traceId ?? null,
        },
      });
      await effect?.(tx, step);
      steps.push(step);
      from = to;
    }
    return { outcome: "advanced", state: request.target, version, steps };
  }
  throw new Error(`payout ${request.payoutId} kept changing under us`);
}
