import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { quickstartExamples, sdkPlaygroundExample } from "../app/docs/content/quickstart-examples.ts";
import { runExample } from "../app/docs/playground-runtime.mjs";
const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../../../spec/fixtures/${name}.json`, import.meta.url)));
const quote = fixture("quote.usdc-ngn-50");
const settled = fixture("payout.settled");
const fixtures = {
  settled,
  "GET /v1/rates/usdc/ngn": fixture("rate.usdc-ngn"),
  "POST /v1/accounts/verify": fixture("verify.gtbank-0123456789"),
  "POST /v1/quote": quote,
  "POST /v1/payouts": fixture("payout.created"),
  [`GET /v1/payouts/${settled.payout_id}`]: settled,
};
const steps = quickstartExamples(quote.quote_id, settled.payout_id);
for (const step of steps) {
  for (const language of ["curl", "TypeScript"]) {
    test(`${step.title}: ${language} runs independently without credentials`, async () => {
      assert.doesNotMatch(step[language], /Authorization|Bearer|FLIQ_KEY|YOUR_/);
      const output = await runExample(step[language], fixtures);
      assert.match(output, /Test response/);
      if (step.id === "verify") assert.match(output, /DARA OKONKWO/);
      if (step.id === "payout") assert.match(output, new RegExp(settled.payout_id));
    });
  }
}
test("editing a key-free quickstart account reports the invalid input", async () => {
  const code = steps.find((step) => step.id === "verify").curl.replace("0123456789", "0000000000");
  await assert.rejects(runExample(code, fixtures), /account_not_found/);
});

test("the SDK guide demo runs without a key or environment setup", async () => {
  assert.doesNotMatch(sdkPlaygroundExample, /Authorization|Bearer|FLIQ_KEY|YOUR_/);
  const result = await runExample(sdkPlaygroundExample, fixtures);
  assert.match(result, /DARA OKONKWO/);
  assert.match(result, /settled/);
});
