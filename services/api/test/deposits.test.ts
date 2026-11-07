import { describe, expect, it } from "vitest";
import { formatUnits, formatUsd, nextDeposit, parseUnits, topUpMessage } from "../apps/api/src/deposits.js";
import type { OneClickExecution } from "../packages/chains/oneclick/index.js";

const reservedUntil = new Date("2026-10-29T08:12:00Z");
const fresh = {
  state: "waiting" as const,
  reservedUntil,
  intentsStatus: null,
  receivedUnits: null,
  landedUnits: null,
  refundedUnits: null,
  refundReason: null,
  originTx: null,
  seenAt: null,
  bridgingAt: null,
  landedAt: null,
};

const execution = (status: OneClickExecution["status"], at: string, extra: Partial<OneClickExecution> = {}): OneClickExecution => ({
  status,
  updatedAt: new Date(at),
  depositedAmount: undefined,
  amountIn: undefined,
  amountOut: undefined,
  refundedAmount: undefined,
  refundReason: undefined,
  originTxHashes: [],
  destinationTxHashes: [],
  nearTxHashes: [],
  ...extra,
});

describe("amounts", () => {
  it("reads and writes token amounts in the token's own decimals", () => {
    expect(parseUnits("200.00", 6)).toBe(200_000_000n);
    expect(parseUnits("0.0001", 8)).toBe(10_000n);
    expect(parseUnits("1.1234567", 6)).toBeNull();
    expect(parseUnits("-1", 6)).toBeNull();
    expect(parseUnits("abc", 6)).toBeNull();
    expect(formatUnits(199_980_000n, 6)).toBe("199.98");
    expect(formatUnits(10_000n, 8)).toBe("0.0001");
  });

  it("shows fees to the nearest cent", () => {
    expect(formatUsd(20_000n)).toBe("0.02");
    expect(formatUsd(24_999n)).toBe("0.02");
    expect(formatUsd(25_000n)).toBe("0.03");
    expect(formatUsd(0n)).toBe("0.00");
  });

  it("names the beneficiary in the message the vault's ft_on_transfer reads", () => {
    expect(JSON.parse(topUpMessage("frank.fliq.near"))).toEqual({ top_up: { account_id: "frank.fliq.near" } });
  });
});

describe("following a top-up", () => {
  const now = new Date("2026-10-29T08:12:20Z");

  it("records each step at the time 1Click saw it", () => {
    const seen = nextDeposit(fresh, execution("KNOWN_DEPOSIT_TX", "2026-10-29T08:11:40Z", { depositedAmount: 200_000_000n, originTxHashes: ["4hXq"] }), now);
    const bridging = nextDeposit(seen, execution("PROCESSING", "2026-10-29T08:11:47Z", { depositedAmount: 200_000_000n }), now);
    const landed = nextDeposit(bridging, execution("SUCCESS", "2026-10-29T08:12:14Z", { depositedAmount: 200_000_000n, amountOut: 199_980_000n }), now);
    expect(landed).toMatchObject({
      state: "landed",
      receivedUnits: 200_000_000n,
      landedUnits: 199_980_000n,
      originTx: "4hXq",
      seenAt: new Date("2026-10-29T08:11:40Z"),
      bridgingAt: new Date("2026-10-29T08:11:47Z"),
      landedAt: new Date("2026-10-29T08:12:14Z"),
    });
  });

  it("fills the steps it skipped when the first answer is already further on", () => {
    const landed = nextDeposit(fresh, execution("SUCCESS", "2026-10-29T08:12:14Z", { amountOut: 199_980_000n }), now);
    expect(landed.seenAt).toEqual(landed.landedAt);
    expect(landed.bridgingAt).toEqual(landed.landedAt);
  });

  it("never goes back a step, and a final state is final", () => {
    const bridging = { ...fresh, state: "bridging" as const, seenAt: now, bridgingAt: now };
    expect(nextDeposit(bridging, execution("KNOWN_DEPOSIT_TX", "2026-10-29T08:12:00Z"), now).state).toBe("bridging");
    const landed = { ...bridging, state: "landed" as const, landedAt: now, landedUnits: 1n };
    expect(nextDeposit(landed, execution("REFUNDED", "2026-10-29T08:12:00Z"), now)).toBe(landed);
  });

  it("lets an underpaid deposit be topped up to seen", () => {
    const underpaid = nextDeposit(fresh, execution("INCOMPLETE_DEPOSIT", "2026-10-29T08:11:40Z", { depositedAmount: 150_000_000n }), now);
    expect(underpaid).toMatchObject({ state: "underpaid", receivedUnits: 150_000_000n });
    expect(nextDeposit(underpaid, execution("KNOWN_DEPOSIT_TX", "2026-10-29T08:11:50Z", { depositedAmount: 200_000_000n }), now).state).toBe("seen");
  });

  it("keeps the refund and its reason", () => {
    const refunded = nextDeposit(fresh, execution("REFUNDED", "2026-10-29T08:13:00Z", { depositedAmount: 5_000_000n, refundedAmount: 5_000_000n, refundReason: "PARTIAL_DEPOSIT" }), now);
    expect(refunded).toMatchObject({ state: "refunded", refundedUnits: 5_000_000n, refundReason: "PARTIAL_DEPOSIT", landedAt: null });
    expect(refunded.seenAt).not.toBeNull();
  });

  it("expires an address nothing arrived at, and wakes up if a late transfer is seen", () => {
    const late = new Date("2026-10-29T08:20:00Z");
    const expired = nextDeposit(fresh, execution("PENDING_DEPOSIT", "2026-10-29T08:19:00Z"), late);
    expect(expired.state).toBe("expired");
    expect(nextDeposit(expired, execution("KNOWN_DEPOSIT_TX", "2026-10-29T08:19:30Z"), late).state).toBe("seen");
  });

  it("treats no answer as no news, except that an address with nothing sent still expires", () => {
    const seen = { ...fresh, state: "seen" as const, seenAt: now };
    expect(nextDeposit(seen, undefined, new Date("2026-10-29T09:00:00Z"))).toBe(seen);
    expect(nextDeposit(fresh, undefined, new Date("2026-10-29T08:13:00Z")).state).toBe("expired");
    expect(nextDeposit(fresh, undefined, new Date("2026-10-29T08:11:00Z"))).toBe(fresh);
  });
});
