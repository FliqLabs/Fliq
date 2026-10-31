import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const spec = parse(await readFile(join(root, "openapi.yaml"), "utf8"));
const index = JSON.parse(await readFile(join(root, "fixtures/index.json"), "utf8"));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema({ $id: "spec", components: spec.components });

let failures = 0;
for (const [file, schemaName] of Object.entries(index)) {
  const fixture = JSON.parse(await readFile(join(root, "fixtures", file), "utf8"));
  const validate = ajv.getSchema(`spec#/components/schemas/${schemaName}`);
  if (!validate) {
    console.error(`${file}: unknown schema ${schemaName}`);
    failures++;
    continue;
  }
  if (!validate(fixture)) {
    console.error(`${file} does not match ${schemaName}:`);
    for (const error of validate.errors) console.error(`  ${error.instancePath || "/"} ${error.message}`);
    failures++;
  }
}

if (failures > 0) process.exit(1);
console.log(`${Object.keys(index).length} fixtures match the spec`);
