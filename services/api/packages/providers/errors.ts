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

// Messages never carry provider response bodies: they can echo account numbers and names.
export class ProviderError extends Error {
  readonly provider: ProviderId;
  readonly operation: ProviderOperation;
  readonly kind: ProviderErrorKind;
  readonly httpStatus?: number;

  constructor(
    provider: ProviderId,
    operation: ProviderOperation,
    kind: ProviderErrorKind,
    detail: string,
    httpStatus?: number,
  ) {
    super(`${provider} ${operation} ${kind}: ${detail}`);
    this.name = "ProviderError";
    this.provider = provider;
    this.operation = operation;
    this.kind = kind;
    if (httpStatus !== undefined) this.httpStatus = httpStatus;
  }

  get transient(): boolean {
    return RETRYABLE.has(this.kind);
  }
}
