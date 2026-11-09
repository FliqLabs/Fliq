import { describe, expect, it } from "vitest";
import { csvCell, displayStatus, parsePayoutFilter } from "../apps/api/src/payout-history.js";

describe("payout history", () => {
  it.each([
    ["created", null, "pending"],
    ["provider_timeout", null, "pending"],
    ["awaiting_recon", null, "pending"],
    ["with_provider", null, "pending"],
    ["paying_out", null, "paying_out"],
    ["settled", null, "settled"],
    ["failed", "vault_daily_cap", "refused"],
    ["failed", "provider_rejected", "failed"],
    ["failed", null, "failed"],
    ["refunding", null, "refunding"],
    ["refunded", null, "refunded"],
    ["expired", null, "expired"],
  ])("shows %s (%s) as %s", (state, failureReason, expected) => {
    expect(displayStatus({ state, failureReason })).toBe(expected);
  });

  it("neutralises spreadsheet formulas and quotes CSV specials", () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tx")).toBe("'\tx");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(42)).toBe("42");
  });

  it("validates filters", () => {
    expect(parsePayoutFilter({ status: "settled, refused", currency: "NGN" })).toEqual({
      statuses: ["settled", "refused"],
      currency: "ngn",
    });
    expect(() => parsePayoutFilter({ status: "lost" })).toThrow(/status/);
    expect(() => parsePayoutFilter({ from: "yesterday" })).toThrow(/from/);
    expect(() => parsePayoutFilter({ from: "2026-11-02T00:00:00Z", to: "2026-11-01T00:00:00Z" })).toThrow(
      /before/,
    );
    expect(() => parsePayoutFilter({ q: "x".repeat(101) })).toThrow(/q/);
  });
});
