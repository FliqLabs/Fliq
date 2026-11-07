import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseVaultEvents } from "./events";

// Interface decision 7: the contract team owns this file, the backend owns this test. A changed event breaks it.
const FIXTURE = new URL("../../../../../contracts/vault/tests/fixtures/events.jsonl", import.meta.url);

const lines = readFileSync(FIXTURE, "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "");

describe("the contract's own event fixtures", () => {
  it("has events to check", () => {
    expect(lines.length).toBeGreaterThan(0);
  });

  it.each(lines)("parses %s", (line) => {
    const parsed = parseVaultEvents(`EVENT_JSON:${line}`);
    expect(parsed).not.toBeNull();
    expect(parsed?.length).toBeGreaterThan(0);
  });
});
