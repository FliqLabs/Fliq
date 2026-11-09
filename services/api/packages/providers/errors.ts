import type { ProviderId } from "./types";

export type ProviderOperation =
  | "quote"
  | "createOrder"
  | "getOrder"
  | "verifyAccount"
  | "institutions"
  | "parseWebhook"
  | "health"
  | "balance";

export type ProviderErrorKind =
  | "timeout"
  | "unavailable"
  | "rejected"
  | "invalid_response"
  | "unmappable_status"
  | "invalid_signature"
  | "not_supported";

const RETRYABLE: ReadonlySet<ProviderErrorKind> = new Set(["timeout", "unavailable"]);

// Messages never carry provider response bodies: they can echo account numbers and names. `reason` is the provider's
// own error code and message, with long digit runs masked, kept apart so it is only logged where it is needed.
export class ProviderError extends Error {
  readonly provider: ProviderId;
  readonly operation: ProviderOperation;
  readonly kind: ProviderErrorKind;
  readonly httpStatus?: number;
  readonly reason?: string;

  constructor(
    provider: ProviderId,
    operation: ProviderOperation,
    kind: ProviderErrorKind,
    detail: string,
    httpStatus?: number,
    reason?: string,
  ) {
    super(`${provider} ${operation} ${kind}: ${detail}`);
    this.name = "ProviderError";
    this.provider = provider;
    this.operation = operation;
    this.kind = kind;
    if (httpStatus !== undefined) this.httpStatus = httpStatus;
    if (reason) this.reason = reason;
  }

  get transient(): boolean {
    return RETRYABLE.has(this.kind);
  }
}

const MAX_REASON = 240;

// The code, message and field errors from a provider's error body, as one short line with account-like numbers masked.
export function providerReason(body: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const record = parsed as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ["code", "error", "message"]) {
    const value = record[key];
    if (typeof value === "string" && value) parts.push(value);
  }
  const fields = Array.isArray(record.data) ? record.data : Array.isArray(record.errors) ? record.errors : [];
  for (const field of fields.slice(0, 3)) {
    if (field && typeof field === "object") {
      const { field: name, message } = field as Record<string, unknown>;
      if (typeof message === "string") parts.push(typeof name === "string" ? `${name}: ${message}` : message);
    }
  }
  if (parts.length === 0) return undefined;
  const line = parts.join("; ").replace(/\d{6,}/g, "[number]").replace(/\s+/g, " ").trim();
  return line.length > MAX_REASON ? `${line.slice(0, MAX_REASON)}...` : line;
}
