export const PAYOUT_STATES = [
  "created",
  "provider_timeout",
  "awaiting_recon",
  "awaiting_deposit",
  "deposit_seen",
  "routing",
  "with_provider",
  "paying_out",
  "settled",
  "refunding",
  "refunded",
  "expired",
  "failed",
] as const;

export type PayoutState = (typeof PAYOUT_STATES)[number];
export type RouteKind = "direct" | "intents" | "vault";

export const TERMINAL_STATES: ReadonlySet<PayoutState> = new Set(["settled", "refunded", "expired", "failed"]);

// Spec 5.1, figure 3. created to failed is added for an outright provider rejection, where nothing was deposited.
const EDGES: Record<PayoutState, readonly PayoutState[]> = {
  created: ["awaiting_deposit", "provider_timeout", "failed"],
  provider_timeout: ["awaiting_recon"],
  awaiting_recon: ["awaiting_deposit", "failed"],
  awaiting_deposit: ["deposit_seen", "expired"],
  deposit_seen: ["routing", "with_provider"],
  routing: ["with_provider", "refunding"],
  with_provider: ["paying_out", "refunding"],
  paying_out: ["settled", "refunding"],
  refunding: ["refunded", "failed"],
  settled: [],
  refunded: [],
  expired: [],
  failed: [],
};

// A signal may imply states we never saw. Only these can be backfilled; the exceptional states need a direct edge.
const BACKFILLABLE: ReadonlySet<PayoutState> = new Set([
  "awaiting_deposit",
  "deposit_seen",
  "routing",
  "with_provider",
  "paying_out",
  "settled",
  "refunding",
  "refunded",
]);

export type Plan =
  | { kind: "advance"; steps: PayoutState[] }
  | { kind: "duplicate" }
  | { kind: "stale" }
  | { kind: "late_signal" }
  | { kind: "illegal" };

// Only Intents routes pass through routing, and on them it is not optional.
function successors(state: PayoutState, route: RouteKind): readonly PayoutState[] {
  return EDGES[state].filter((next) => {
    if (route === "intents") return !(state === "deposit_seen" && next === "with_provider");
    return next !== "routing";
  });
}

function shortestPath(from: PayoutState, to: PayoutState, route: RouteKind): PayoutState[] | null {
  const previous = new Map<PayoutState, PayoutState | null>([[from, null]]);
  const queue: PayoutState[] = [from];
  for (const state of queue) {
    if (state === to) break;
    for (const next of successors(state, route)) {
      if (previous.has(next)) continue;
      previous.set(next, state);
      queue.push(next);
    }
  }
  if (!previous.has(to)) return null;
  const path: PayoutState[] = [];
  for (let at: PayoutState | null = to; at !== null && at !== from; at = previous.get(at) ?? null) path.unshift(at);
  return path;
}

// True when `ancestor` lies on some path that leads to `state`, so a signal for it describes the past.
function leadsTo(ancestor: PayoutState, state: PayoutState): boolean {
  return ancestor !== state && shortestPath(ancestor, state, "intents") !== null;
}

export function plan(current: PayoutState, target: PayoutState, route: RouteKind): Plan {
  if (current === target) return { kind: "duplicate" };
  if (leadsTo(target, current)) return { kind: "stale" };
  if (TERMINAL_STATES.has(current)) return { kind: "late_signal" };

  const path = shortestPath(current, target, route);
  if (!path) return { kind: "illegal" };
  if (path.length > 1 && !BACKFILLABLE.has(target)) return { kind: "illegal" };
  return { kind: "advance", steps: path };
}
