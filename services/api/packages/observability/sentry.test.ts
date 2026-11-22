import { describe, expect, it } from "vitest";
import { initSentry, scrubUrl } from "./sentry.js";

describe("scrubUrl", () => {
  it("hides sign-in tokens and other secrets in the query", () => {
    expect(scrubUrl("/auth/verify?token=el_abc&next=/home")).toBe("/auth/verify?token=[redacted]&next=/home");
    expect(scrubUrl("https://x.test/a?code=1&key=2&page=3")).toBe(
      "https://x.test/a?code=[redacted]&key=[redacted]&page=3",
    );
  });

  it("leaves a url without secrets alone", () => {
    expect(scrubUrl("/v1/payouts?limit=20")).toBe("/v1/payouts?limit=20");
  });
});

describe("initSentry", () => {
  it("does nothing without a DSN", () => {
    expect(initSentry("api", {})).toBe(false);
    expect(initSentry("relayer", { SENTRY_DSN: "  " })).toBe(false);
  });
});
