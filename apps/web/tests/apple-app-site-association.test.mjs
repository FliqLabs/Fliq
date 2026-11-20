import assert from "node:assert/strict";
import test from "node:test";
import { association } from "../app/lib/apple-app-site-association.ts";

test("passkeys keep working for both iPhone apps", () => {
  assert.deepEqual(association.webcredentials.apps, ["YCKKUWB4WD.cash.fliq.app", "YCKKUWB4WD.cash.fliq.app.mainnet"]);
});

test("payment request links open the mainnet app, and nothing else on the site does", () => {
  const [detail] = association.applinks.details;
  assert.deepEqual(detail.appIDs, ["YCKKUWB4WD.cash.fliq.app.mainnet"]);
  assert.deepEqual(detail.components.map((component) => component["/"]), ["/pay/*/*"]);
});
