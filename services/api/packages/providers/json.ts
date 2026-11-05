import { ProviderError, type ProviderOperation } from "./errors";
import { InvalidAmountError, toUnits, type Rounding } from "./money";
import type { ProviderId } from "./types";

export type JsonObject = Record<string, unknown>;

// Errors name the field, never its value: provider payloads carry account numbers and names.
export function jsonReader(provider: ProviderId, operation: ProviderOperation) {
  const fail = (detail: string) => new ProviderError(provider, operation, "invalid_response", detail);

  function object(value: unknown, name: string): JsonObject {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      throw fail(`${name} is not an object`);
    return value as JsonObject;
  }

  function array(value: unknown, name: string): unknown[] {
    if (!Array.isArray(value)) throw fail(`${name} is not an array`);
    return value;
  }

  function string(record: JsonObject, key: string): string {
    const value = record[key];
    if (typeof value !== "string" || value === "") throw fail(`${key} is missing`);
    return value;
  }

  function optionalString(record: JsonObject, key: string): string | undefined {
    const value = record[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  }

  function units(record: JsonObject, key: string, decimals: number, rounding: Rounding = "exact"): bigint {
    try {
      return toUnits(string(record, key), decimals, rounding);
    } catch (error) {
      if (error instanceof InvalidAmountError) throw fail(`${key} is not a valid amount`);
      throw error;
    }
  }

  function date(record: JsonObject, key: string): Date {
    const parsed = new Date(string(record, key));
    if (Number.isNaN(parsed.getTime())) throw fail(`${key} is not a date`);
    return parsed;
  }

  return { fail, object, array, string, optionalString, units, date };
}
