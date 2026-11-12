import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runExample } from "../app/docs/playground-runtime.mjs";
const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../../../spec/fixtures/${name}.json`, import.meta.url)));
const fixtures = {
  "GET /v1/rates/usdc/ngn": fixture("rate.usdc-ngn"),
  "POST /v1/quote": fixture("quote.usdc-ngn-50"),
  "POST /v1/accounts/verify": fixture("verify.gtbank-0123456789"),
};
test("curl runs against the canonical rate fixture", async () => {
  const result = await runExample("curl https://fliq-yclq.onrender.com/v1/rates/usdc/ngn", fixtures);
  assert.match(result, /Test response/);
  assert.match(result, /1376.32/);
});
test("edited JavaScript executes rather than returning canned code output", async () => {
  assert.equal(
    await runExample("console.log([2, 3, 4].map(x => x * 2));", fixtures),
    "[\n  4,\n  6,\n  8\n]",
  );
});
test("fetch can consume the quote fixture", async () => {
  const output = await runExample(
    `const r = await fetch('/v1/quote', {method: 'POST', body: JSON.stringify({token:'usdc', currency:'ngn', amount:'50.00'})}); console.log((await r.json()).quote_id);`,
    fixtures,
  );
  assert.match(output, new RegExp(fixtures["POST /v1/quote"].quote_id));
});
test("invalid JSON and JavaScript produce errors", async () => {
  await assert.rejects(runExample('{"amount":}', fixtures), /Invalid JSON/);
  await assert.rejects(runExample("const = nonsense;", fixtures), SyntaxError);
});
test("incorrect accounts and unsupported amounts do not pretend to succeed", async () => {
  await assert.rejects(
    runExample(
      `curl -X POST https://fliq-yclq.onrender.com/v1/accounts/verify -d '{"bank":"058","number":"0000000000"}'`,
      fixtures,
    ),
    /account_not_found/,
  );
  await assert.rejects(
    runExample(
      `curl -X POST https://fliq-yclq.onrender.com/v1/quote -d '{"token":"usdc","currency":"ngn","amount":"banana"}'`,
      fixtures,
    ),
    /demo supports/,
  );
});
test("unknown endpoints and external URLs fail clearly", async () => {
  await assert.rejects(
    runExample("curl https://fliq-yclq.onrender.com/v1/typo", fixtures),
    /Check the endpoint/,
  );
  await assert.rejects(runExample('await fetch("https://example.com")', fixtures), /External requests/);
});
test("installation commands are identified as terminal-only", async () => {
  await assert.rejects(runExample("npm install @fliq/sdk", fixtures), /own terminal/);
});
