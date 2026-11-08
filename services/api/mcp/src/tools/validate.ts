import type { JsonSchema } from "./definitions.js";

// Covers exactly the keywords the tool schemas use, so the tools need no JSON Schema library.
// Returns the first problem as a sentence, or null when the value fits.
export function validate(schema: JsonSchema, value: unknown, path = "arguments"): string | null {
  if (schema.type === "object") return validateObject(schema, value, path);
  if (typeof value !== "string") return `${path} must be a string.`;
  if (schema.enum && !schema.enum.includes(value)) return `${path} must be one of ${schema.enum.join(", ")}.`;
  if (schema.pattern && !new RegExp(schema.pattern).test(value))
    return `${path} is not in the expected format.`;
  if (schema.minLength !== undefined && value.length < schema.minLength) return `${path} is too short.`;
  if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${path} is too long.`;
  return null;
}

function validateObject(schema: JsonSchema, value: unknown, path: string): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return `${path} must be an object.`;
  const record = value as Record<string, unknown>;
  const properties = schema.properties ?? {};
  const missing = (schema.required ?? []).find((name) => record[name] === undefined);
  if (missing) return `${path}.${missing} is required.`;
  for (const [name, field] of Object.entries(record)) {
    const fieldSchema = properties[name];
    if (!fieldSchema) {
      if (schema.additionalProperties === false) return `${path}.${name} is not a known field.`;
      continue;
    }
    if (field === undefined) continue;
    const problem = validate(fieldSchema, field, `${path}.${name}`);
    if (problem) return problem;
  }
  return null;
}
