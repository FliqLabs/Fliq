import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { isFinal, outcomeOf, progress } from "../app/lib/payout-progress.ts";

const fixture = (name) => JSON.parse(readFileSync(new URL(`../../../spec/fixtures/${name}.json`, import.meta.url), "utf8"));
const names = { provider: "Paycrest", bank: "GTBank" };

test("a settled payout shows every step done", () => {
  const steps = progress(fixture("payout.settled"), names);
  assert.ok(steps.every((step) => step.state === "done"));
  assert.equal(steps.at(-1).title, "Paid");
  assert.equal(outcomeOf("settled"), "paid");
});

test("a payout that just started shows the next step as current", () => {
  const steps = progress(fixture("payout.created"), names);
  assert.equal(steps.filter((step) => step.state === "now").length, 1);
  assert.equal(isFinal(fixture("payout.created").state), false);
});

test("a refunded payout ends with the money back in the vault", () => {
  const payout = fixture("payout.refunded");
  const steps = progress(payout, names);
  assert.equal(steps.at(-1).key, "refund");
  assert.equal(steps.at(-1).state, "done");
  assert.match(steps.at(-1).title, /back in your vault/);
  assert.equal(outcomeOf(payout.state), "refunded");
});

test("a provider timeout is shown as a check, not a failure", () => {
  const payout = { ...fixture("payout.created"), state: "provider_timeout", history: [{ state: "created", at: "2026-10-29T13:02:10Z" }, { state: "with_provider", at: "2026-10-29T13:02:20Z" }, { state: "provider_timeout", at: "2026-10-29T13:03:20Z" }] };
  const steps = progress(payout, names);
  assert.equal(steps.at(-1).key, "checking");
  assert.equal(steps.at(-1).state, "now");
});
