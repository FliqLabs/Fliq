import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import openapiTS, { astToString } from "openapi-typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const committed = await readFile(join(root, "ts/openapi.ts"), "utf8");
const fresh = astToString(await openapiTS(new URL(`file://${join(root, "openapi.yaml")}`)));

const normalize = (text) => text.replace(/^\/\*\*[\s\S]*?\*\/\s*/, "").trim();

if (normalize(committed) !== normalize(fresh)) {
  console.error("spec/ts/openapi.ts is out of date. Run: pnpm --filter @fliq/spec generate");
  process.exit(1);
}
console.log("generated types are up to date");
