import { execFileSync } from "node:child_process";
import { copyFileSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The spec package is private, so the published types carry a copy of the generated OpenAPI types
// taken at build time instead of importing @fliq/spec.
const root = fileURLToPath(new URL("..", import.meta.url));
const dist = `${root}dist/`;
const generated = fileURLToPath(new URL("../../../../spec/ts/openapi.ts", import.meta.url));
const tsc = fileURLToPath(new URL("../../node_modules/typescript/bin/tsc", import.meta.url));

rmSync(dist, { recursive: true, force: true });
execFileSync(process.execPath, [tsc, "-p", `${root}tsconfig.build.json`], { stdio: "inherit" });
copyFileSync(generated, `${dist}openapi.d.ts`);

for (const file of readdirSync(dist).filter((name) => name.endsWith(".d.ts"))) {
  const path = `${dist}${file}`;
  const rewritten = readFileSync(path, "utf8").replaceAll('"@fliq/spec"', '"./openapi.js"');
  writeFileSync(path, rewritten);
}
