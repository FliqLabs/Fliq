import type { Quote } from "./types.js";

export type FliqErrorCode =
  | "invalid_request"
  | "no_route"
  | "quote_expired"
  | "account_not_found"
  | "account_name_required"
  | "velocity_limit"
  | "provider_rejected"
  | "quote_changed"
  | "route_unavailable"
  | "insufficient_balance"
  | "unauthorized"
  | "forbidden"
  | "live_not_enabled"
  | "environment_unavailable"
  | "limit_reached"
  | "not_found"
  | "conflict"
  | "idempotency_key_required"
  | "idempotency_mismatch"
  | "rate_limited"
  | "chain_unavailable"
  | "agent_limit"
  | "internal"
  | "network_error"
  | "invalid_response"
  | "timeout"
  | (string & {});

export class FliqError extends Error {
  override readonly name = "FliqError";
  readonly status: number;
  readonly code: FliqErrorCode;
  readonly body: unknown;
  readonly traceId: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(options: {
    status: number;
    code: FliqErrorCode;
    message: string;
    body?: unknown;
    traceId?: string | null;
    retryAfterSeconds?: number | null;
  }) {
    super(options.message);
    this.status = options.status;
    this.code = options.code;
    this.body = options.body ?? null;
    this.traceId = options.traceId ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }

  // Only with quote_changed: the fresh quote to confirm, since the rate moved and nothing was sent.
  get quote(): Quote | null {
    return isRecord(this.body) && isRecord(this.body.quote) ? (this.body.quote as Quote) : null;
  }

  // Worth sending again unchanged: the network, a rate limit or a server-side hiccup.
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
