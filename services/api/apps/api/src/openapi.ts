import { readFileSync } from "node:fs";
import { parse } from "yaml";

type Json = Record<string, any>;

export interface Operation {
  operationId: string;
  method: "get" | "post" | "patch" | "put" | "delete";
  openapiPath: string;
  fastifyPath: string;
  isPublic: boolean;
  bodySchema: Json | undefined;
}

const METHODS = ["get", "post", "patch", "put", "delete"] as const;
const SPEC_URL = new URL("../../../../../spec/openapi.yaml", import.meta.url);

export function loadSpec(): Json {
  return parse(readFileSync(SPEC_URL, "utf8")) as Json;
}

function resolve(node: unknown, components: Json): unknown {
  if (Array.isArray(node)) return node.map((item) => resolve(item, components));
  if (node === null || typeof node !== "object") return node;
  const object = node as Json;
  if (typeof object.$ref === "string") {
    const name = object.$ref.split("/").pop() as string;
    return resolve(components.schemas[name], components);
  }
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, resolve(value, components)]));
}

// Unknown request fields are rejected, so every object with named properties is closed unless the spec says otherwise.
function closeObjects(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(closeObjects);
  if (node === null || typeof node !== "object") return node;
  const object = Object.fromEntries(Object.entries(node as Json).map(([key, value]) => [key, closeObjects(value)]));
  if (object.properties && object.additionalProperties === undefined) object.additionalProperties = false;
  return object;
}

export function operations(spec: Json): Operation[] {
  const found: Operation[] = [];
  for (const [openapiPath, item] of Object.entries<Json>(spec.paths)) {
    for (const method of METHODS) {
      const operation = item[method];
      if (!operation) continue;
      const body = operation.requestBody?.content?.["application/json"]?.schema;
      found.push({
        operationId: operation.operationId,
        method,
        openapiPath,
        fastifyPath: `/v1${openapiPath.replace(/\{(\w+)\}/g, ":$1")}`,
        isPublic: Array.isArray(operation.security) && operation.security.length === 0,
        bodySchema: body ? (closeObjects(resolve(body, spec.components)) as Json) : undefined,
      });
    }
  }
  return found;
}
