import { describe, expect, it } from "vitest";
import { hopReporter } from "../apps/api/src/hop-watch.js";
import type { OneClickExecution, OneClickStatus } from "../packages/chains/oneclick/types.js";

const CREATED = new Date("2026-11-12T11:31:48Z");
const hop = { payoutId: "po_1", createdAt: CREATED, validUntil: new Date("2026-11-12T12:26:37Z") };
const after = (minutes: number) => new Date(CREATED.getTime() + minutes * 60_000);
const leg = (status: OneClickStatus, refundReason?: string): OneClickExecution => ({
  status,
  updatedAt: CREATED,
  depositedAmount: undefined,
  amountIn: undefined,
  amountOut: undefined,
  refundedAmount: undefined,
  refundReason,
  originTxHashes: [],
  destinationTxHashes: [],
  nearTxHashes: [],
});

function reporter() {
  const lines: string[] = [];
  return { lines, report: hopReporter((line) => lines.push(line)) };
}

describe("watching the 1Click swap behind a cash-out", () => {
  it("says nothing while a swap is young, and nothing when it delivers", () => {
    const { lines, report } = reporter();
    report(hop, leg("PROCESSING"), after(1));
    report(hop, leg("SUCCESS"), after(2));
    expect(lines).toEqual([]);
  });

  it("stays quiet about a cash-out the user never signed", () => {
    const { lines, report } = reporter();
    report(hop, leg("PENDING_DEPOSIT"), after(20));
    report(hop, leg("PENDING_DEPOSIT"), after(90));
    expect(lines).toEqual([]);
  });

  it("reports a held swap once per step, however often it is polled", () => {
    const { lines, report } = reporter();
    for (const minute of [5, 5.4, 6, 14]) report(hop, leg("PROCESSING"), after(minute));
    report(hop, leg("PROCESSING"), after(16));
    expect(lines).toEqual([
      "[hop-watch] po_1: held 5 min at 1Click (PROCESSING)",
      "[hop-watch] po_1: held 16 min at 1Click (PROCESSING)",
    ]);
  });

  it("warns once when the provider's window closes before 1Click delivers", () => {
    const { lines, report } = reporter();
    report(hop, leg("PROCESSING"), after(56));
    report(hop, leg("PROCESSING"), after(70));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("the provider's window has closed");
  });

  it("reports a refund with 1Click's reason", () => {
    const { lines, report } = reporter();
    report(hop, leg("REFUNDED", "deadline exceeded"), after(3));
    report(hop, leg("REFUNDED", "deadline exceeded"), after(4));
    expect(lines).toEqual([
      "[hop-watch] po_1: 1Click REFUNDED the swap (deadline exceeded); the USDC is back in the vault and the provider's order will lapse",
    ]);
  });
});
