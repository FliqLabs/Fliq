export type ErrorCode =
  | "invalid_request"
  | "unauthorized"
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
