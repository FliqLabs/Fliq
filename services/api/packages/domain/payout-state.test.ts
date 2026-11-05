import { describe, expect, it } from "vitest";
import { PAYOUT_STATES, TERMINAL_STATES, plan, type PayoutState, type RouteKind } from "./payout-state.js";

const ROUTES: RouteKind[] = ["direct", "intents", "vault"];

describe("every state pair", () => {
  for (const route of ROUTES) {
    it(`never leaves a terminal state by advancing (${route})`, () => {
      for (const current of TERMINAL_STATES) {
        for (const target of PAYOUT_STATES) {
          expect(plan(current, target, route).kind).not.toBe("advance");
        }
      }
    });

    it(`only advances along real steps and records routing only on Intents routes (${route})`, () => {
      for (const current of PAYOUT_STATES) {
        for (const target of PAYOUT_STATES) {
          const result = plan(current, target, route);
          if (result.kind !== "advance") continue;
          expect(result.steps.at(-1)).toBe(target);
          expect(result.steps).not.toContain(current);
          if (route !== "intents") expect(result.steps).not.toContain("routing");
        }
      }
    });
  }
});

describe("single steps", () => {
  const legal: [PayoutState, PayoutState][] = [
    ["created", "awaiting_deposit"],
    ["created", "provider_timeout"],
    ["provider_timeout", "awaiting_recon"],
    ["awaiting_recon", "awaiting_deposit"],
    ["awaiting_recon", "failed"],
    ["awaiting_deposit", "deposit_seen"],
    ["awaiting_deposit", "expired"],
    ["deposit_seen", "with_provider"],
    ["with_provider", "paying_out"],
    ["paying_out", "settled"],
    ["paying_out", "refunding"],
    ["refunding", "refunded"],
    ["refunding", "failed"],
  ];

  it.each(legal)("%s to %s is one step", (from, to) => {
    expect(plan(from, to, "direct")).toEqual({ kind: "advance", steps: [to] });
  });

  it("routes only Intents payouts through routing, and always", () => {
    expect(plan("deposit_seen", "routing", "intents")).toEqual({ kind: "advance", steps: ["routing"] });
    expect(plan("deposit_seen", "routing", "direct").kind).toBe("illegal");
    expect(plan("deposit_seen", "routing", "vault").kind).toBe("illegal");
    expect(plan("deposit_seen", "with_provider", "vault")).toEqual({ kind: "advance", steps: ["with_provider"] });
    expect(plan("deposit_seen", "with_provider", "intents")).toEqual({ kind: "advance", steps: ["routing", "with_provider"] });
  });
});

describe("illegal moves", () => {
  it.each<[PayoutState, PayoutState]>([
    ["deposit_seen", "expired"],
    ["created", "expired"],
    ["awaiting_deposit", "failed"],
    ["deposit_seen", "failed"],
  ])("%s to %s is rejected", (from, to) => {
    expect(plan(from, to, "intents").kind).toBe("illegal");
  });
});

describe("signals that skip states", () => {
  it("backfills the states a paid signal implies", () => {
    expect(plan("awaiting_deposit", "settled", "direct")).toEqual({
      kind: "advance",
      steps: ["deposit_seen", "with_provider", "paying_out", "settled"],
    });
    expect(plan("awaiting_deposit", "settled", "intents")).toEqual({
      kind: "advance",
      steps: ["deposit_seen", "routing", "with_provider", "paying_out", "settled"],
    });
  });

  it("walks a timed-out order back onto the main path when the provider answers first", () => {
    expect(plan("provider_timeout", "with_provider", "direct")).toEqual({
      kind: "advance",
      steps: ["awaiting_recon", "awaiting_deposit", "deposit_seen", "with_provider"],
    });
  });

  it("backfills the refund path", () => {
    expect(plan("paying_out", "refunded", "direct")).toEqual({ kind: "advance", steps: ["refunding", "refunded"] });
  });

  it("never backfills into failure states", () => {
    expect(plan("awaiting_deposit", "failed", "direct").kind).toBe("illegal");
    expect(plan("created", "awaiting_recon", "direct").kind).toBe("illegal");
  });
});

describe("repeats and late signals", () => {
  it("treats the same state as a duplicate", () => {
    for (const state of PAYOUT_STATES) expect(plan(state, state, "direct").kind).toBe("duplicate");
  });

  it("ignores a signal about the past", () => {
    expect(plan("paying_out", "deposit_seen", "direct").kind).toBe("stale");
    expect(plan("settled", "deposit_seen", "direct").kind).toBe("stale");
    expect(plan("expired", "awaiting_deposit", "direct").kind).toBe("stale");
    expect(plan("with_provider", "provider_timeout", "direct").kind).toBe("stale");
    expect(plan("paying_out", "awaiting_recon", "direct").kind).toBe("stale");
  });

  it("opens a reconciliation case when a terminal payout is contradicted", () => {
    expect(plan("settled", "refunding", "direct").kind).toBe("late_signal");
    expect(plan("refunded", "settled", "direct").kind).toBe("late_signal");
    expect(plan("expired", "deposit_seen", "direct").kind).toBe("late_signal");
    expect(plan("failed", "settled", "direct").kind).toBe("late_signal");
  });
});

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]),
  );
}

function replay(start: PayoutState, signals: PayoutState[], route: RouteKind) {
  let state = start;
  const recorded: PayoutState[] = [];
  const cases: PayoutState[] = [];
  for (const signal of signals) {
    const result = plan(state, signal, route);
    if (result.kind === "advance") {
      recorded.push(...result.steps);
      state = result.steps.at(-1) as PayoutState;
    }
    if (result.kind === "late_signal") cases.push(signal);
  }
  return { state, recorded, cases };
}

describe("out-of-order signals converge", () => {
  const happyDirect: PayoutState[] = ["deposit_seen", "with_provider", "paying_out", "settled"];
  const happyIntents: PayoutState[] = ["deposit_seen", "routing", "with_provider", "paying_out", "settled"];

  it("settles every ordering of a direct payout with each state recorded once, in order", () => {
    for (const order of permutations(happyDirect)) {
      const result = replay("awaiting_deposit", order, "direct");
      expect(result.state, order.join(">")).toBe("settled");
      expect(result.recorded, order.join(">")).toEqual(happyDirect);
      expect(result.cases, order.join(">")).toEqual([]);
    }
  });

  it("settles every ordering of an Intents payout the same way", () => {
    for (const order of permutations(happyIntents)) {
      const result = replay("awaiting_deposit", order, "intents");
      expect(result.state, order.join(">")).toBe("settled");
      expect(result.recorded, order.join(">")).toEqual(happyIntents);
    }
  });

  it("refunds every ordering of a failed Intents payout once", () => {
    const refund: PayoutState[] = ["deposit_seen", "routing", "refunding", "refunded"];
    for (const order of permutations(refund)) {
      const result = replay("awaiting_deposit", order, "intents");
      expect(result.state, order.join(">")).toBe("refunded");
      expect(result.recorded, order.join(">")).toEqual(refund);
    }
  });
});
