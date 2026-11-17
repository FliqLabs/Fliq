import { describe, expect, it } from "vitest";
import { chainName, depositActivityState, liveActivityPayload, payoutActivityState } from "../apps/api/src/live-activities.js";

const deposit = (state: string, at: { seenAt?: Date; bridgingAt?: Date } = {}) =>
  depositActivityState({ state, chain: "solana", seenAt: at.seenAt ?? null, bridgingAt: at.bridgingAt ?? null });
const step = (value: ReturnType<typeof depositActivityState>) => [value.content.step, value.content.status, value.content.done, value.content.failed, value.final];
const when = new Date("2026-11-16T12:00:00Z");

describe("live activity content", () => {
  it("walks a deposit through three steps to the vault", () => {
    expect(step(deposit("waiting"))).toEqual([0, "Waiting for it", false, false, false]);
    expect(step(deposit("seen", { seenAt: when }))).toEqual([1, "Seen on Solana", false, false, false]);
    expect(step(deposit("bridging", { seenAt: when, bridgingAt: when }))).toEqual([2, "Moving to your vault", false, false, false]);
    expect(step(deposit("landed"))).toEqual([3, "In your vault", true, false, true]);
    expect(deposit("landed").content.steps).toBe(3);
  });

  it("names the chain the way the app does", () => {
    expect(chainName("near")).toBe("NEAR");
    expect(chainName("bnb")).toBe("BNB Chain");
    expect(chainName("base")).toBe("Base");
  });

  it("ends a failed deposit at the furthest step it reached", () => {
    expect(step(deposit("underpaid"))).toEqual([1, "Too little sent", false, true, true]);
    expect(step(deposit("refunded", { seenAt: when }))).toEqual([1, "Refunded", false, true, true]);
    expect(step(deposit("expired"))).toEqual([0, "Nothing arrived", false, true, true]);
    expect(step(deposit("failed", { seenAt: when, bridgingAt: when }))).toEqual([2, "Didn't arrive", false, true, true]);
  });

  it("walks a cash-out to the bank, and keeps a refund going until it is done", () => {
    const payout = (state: string) => step(payoutActivityState({ state }));
    for (const state of ["created", "provider_timeout", "awaiting_recon", "awaiting_deposit"]) expect(payout(state)).toEqual([0, "Sending", false, false, false]);
    for (const state of ["deposit_seen", "routing"]) expect(payout(state)).toEqual([1, "On its way to the bank", false, false, false]);
    for (const state of ["with_provider", "paying_out"]) expect(payout(state)).toEqual([2, "The bank is paying", false, false, false]);
    expect(payout("settled")).toEqual([3, "Paid out", true, false, true]);
    expect(payout("refunding")).toEqual([2, "Refunding", false, true, false]);
    expect(payout("refunded")).toEqual([2, "Refunded to your vault", false, true, true]);
    expect(payout("expired")).toEqual([0, "Not paid", false, true, true]);
    expect(payout("failed")).toEqual([0, "Not paid", false, true, true]);
  });

  it("is the exact payload the iPhone decodes, with a dismissal date only on end", () => {
    const content = deposit("seen", { seenAt: when }).content;
    expect(liveActivityPayload(content, 1_794_830_400)).toEqual({
      aps: {
        timestamp: 1_794_830_400,
        event: "update",
        "content-state": { step: 1, steps: 3, status: "Seen on Solana", done: false, failed: false },
      },
    });
    expect(liveActivityPayload(content, 1_794_830_400, true).aps).toMatchObject({ event: "end", "dismissal-date": 1_794_831_300 });
  });
});
