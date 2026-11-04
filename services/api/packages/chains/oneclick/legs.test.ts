import { describe, expect, it } from "vitest";
import { applyStatus, legSignal, nextPollAt, pollLeg, startLeg } from "./index";
import { DEPOSIT, execution, fakeFetch, json, testClient as client } from "./oneclick.fixtures";

describe("Intents leg tracking", () => {
  const start = new Date("2026-11-05T12:00:00.000Z");
  const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);

  it("polls every 5 seconds for 10 minutes, then every 60 seconds, and stops at a terminal status", () => {
    const leg = startLeg(DEPOSIT, undefined, start);
    expect(nextPollAt(leg, at(9))!.getTime() - at(9).getTime()).toBe(5_000);
    expect(nextPollAt(leg, at(10))!.getTime() - at(10).getTime()).toBe(60_000);
    expect(nextPollAt(applyStatus(leg, "SUCCESS", at(1)).state, at(1))).toBeNull();
  });

  it("flags and alerts once when a deposit is held in processing for 15 minutes", () => {
    let leg = applyStatus(startLeg(DEPOSIT, undefined, start), "PROCESSING", at(1)).state;
    expect(applyStatus(leg, "PROCESSING", at(15)).alerts).toEqual([]);
    const held = applyStatus(leg, "PROCESSING", at(16));
    expect(held.state.held).toBe(true);
    expect(held.alerts).toEqual([
      { kind: "held", depositAddress: DEPOSIT, status: "PROCESSING", minutes: 15 },
    ]);
    leg = held.state;
    expect(applyStatus(leg, "PROCESSING", at(30)).alerts).toEqual([]);
    expect(applyStatus(leg, "SUCCESS", at(31)).state.held).toBe(false);
  });

  it("never holds a leg that is waiting for its deposit", () => {
    const leg = applyStatus(startLeg(DEPOSIT, undefined, start), "PENDING_DEPOSIT", at(0)).state;
    expect(applyStatus(leg, "PENDING_DEPOSIT", at(40)).state.held).toBe(false);
  });

  it("keeps a terminal status and alerts if 1Click later reports a different one", () => {
    const refunded = applyStatus(startLeg(DEPOSIT, undefined, start), "REFUNDED", at(5)).state;
    const step = applyStatus(refunded, "SUCCESS", at(6));
    expect(step.state.status).toBe("REFUNDED");
    expect(step.alerts).toEqual([
      { kind: "terminal_changed", depositAddress: DEPOSIT, from: "REFUNDED", to: "SUCCESS" },
    ]);
  });

  it("leaves the leg unchanged when 1Click is down, and alerts when the answer is unreadable", async () => {
    const leg = applyStatus(startLeg(DEPOSIT, undefined, start), "PROCESSING", at(1)).state;
    const down = await pollLeg(client(fakeFetch(() => new Response("", { status: 503 })).fetch), leg, () =>
      at(2),
    );
    expect(down).toMatchObject({ state: leg, changed: false, alerts: [] });
    expect(down.error?.kind).toBe("unavailable");
    expect(down.nextPollAt).toEqual(new Date(at(2).getTime() + 5_000));

    const unreadable = await pollLeg(client(fakeFetch(() => json(execution("ON_HOLD"))).fetch), leg, () =>
      at(3),
    );
    expect(unreadable.state).toBe(leg);
    expect(unreadable.alerts[0]).toMatchObject({ kind: "unreadable_status", depositAddress: DEPOSIT });
  });

  it("reports outcomes through the leg signal", async () => {
    const leg = startLeg(DEPOSIT, undefined, start);
    const polled = await pollLeg(
      client(fakeFetch(() => json(execution("REFUNDED", { refundedAmount: "50300000" }))).fetch),
      leg,
      () => at(1),
    );
    expect(polled.state.status).toBe("REFUNDED");
    expect(polled.execution?.refundedAmount).toBe(50_300_000n);
    expect(polled.nextPollAt).toBeNull();
    expect(
      ["KNOWN_DEPOSIT_TX", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "FAILED"].map((s) =>
        legSignal(s as never),
      ),
    ).toEqual(["deposit_seen", "underpaid", "routing", "delivered", "failed"]);
  });
});
