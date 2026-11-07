export type ErrorCode =
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
  | "internal";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const unauthorized = (message = "Missing or invalid credentials.") => new ApiError(401, "unauthorized", message);
export const invalidRequest = (message: string) => new ApiError(400, "invalid_request", message);
export const forbidden = (message: string) => new ApiError(403, "forbidden", message);
export const conflict = (message: string) => new ApiError(409, "conflict", message);

// A transaction that must commit even though the request fails (for example revoking a reused session)
// returns a rejection instead of throwing; the caller throws it after the commit.
export type Outcome<T> = { value: T } | { rejected: ApiError };

export const accepted = <T>(value: T): Outcome<T> => ({ value });
export const rejected = (error: ApiError): Outcome<never> => ({ rejected: error });

export function settle<T>(outcome: Outcome<T>): T {
  if ("rejected" in outcome) throw outcome.rejected;
  return outcome.value;
}

export const notFound = (message: string) => new ApiError(404, "not_found", message);

export function requireHttpsUrl(value: string | null | undefined): void {
  if (!value) return;
  if (!URL.canParse(value) || new URL(value).protocol !== "https:") throw invalidRequest("photo_url must be an https URL.");
}
