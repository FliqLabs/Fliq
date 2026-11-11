import { FliqError, isRecord } from "./errors.js";
import { isFinalState } from "./states.js";
import type {
  AccountLookup,
  InstitutionList,
  Payout,
  PayoutCountry,
  PayoutList,
  PayoutRequest,
  PayoutStats,
  ProviderId,
  Quote,
  QuoteRequest,
  Rate,
  VerifiedAccount,
} from "./types.js";

export const DEFAULT_BASE_URL = "https://api-production-54e10.up.railway.app/v1";
export const SDK_VERSION = "0.1.1";

export interface FliqClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface ListPayoutsParams {
  limit?: number;
  cursor?: string;
  // Comma-separated dashboard statuses, for example "settled,refused".
  status?: string;
  provider?: ProviderId;
  currency?: string;
  from?: string;
  to?: string;
  q?: string;
}

export interface CreatePayoutOptions {
  // Sent as the Idempotency-Key header. Generated when left out; pass your own to retry safely across restarts.
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface WaitForPayoutOptions {
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
  onUpdate?: (payout: Payout) => void;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

const DEFAULT_WAIT_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;

type Method = "GET" | "POST";
type Query = Record<string, string | number | undefined>;

export class FliqClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;

  constructor(options: FliqClientOptions) {
    if (!options.apiKey) throw new Error("apiKey is required.");
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  getRate(
    token: QuoteRequest["token"],
    currency: QuoteRequest["currency"],
    options: RequestOptions = {},
  ): Promise<Rate> {
    return this.request<Rate>("GET", `/rates/${token}/${currency}`, { signal: options.signal });
  }

  // POST /quotes: every eligible provider, ranked. routes[0] is what createPayout pays.
  quote(input: QuoteRequest, options: RequestOptions = {}): Promise<Quote> {
    return this.request<Quote>("POST", "/quotes", { body: input, signal: options.signal });
  }

  institutions(country: PayoutCountry = "ng", options: RequestOptions = {}): Promise<InstitutionList> {
    return this.request<InstitutionList>("GET", "/institutions", {
      query: { country },
      signal: options.signal,
    });
  }

  verifyAccount(input: AccountLookup, options: RequestOptions = {}): Promise<VerifiedAccount> {
    return this.request<VerifiedAccount>("POST", "/accounts/verify", { body: input, signal: options.signal });
  }

  createPayout(input: PayoutRequest, options: CreatePayoutOptions = {}): Promise<Payout> {
    const idempotencyKey = options.idempotencyKey ?? globalThis.crypto.randomUUID();
    return this.request<Payout>("POST", "/payouts", {
      body: input,
      headers: { "idempotency-key": idempotencyKey },
      signal: options.signal,
    });
  }

  getPayout(payoutId: string, options: RequestOptions = {}): Promise<Payout> {
    return this.request<Payout>("GET", `/payouts/${encodeURIComponent(payoutId)}`, {
      signal: options.signal,
    });
  }

  listPayouts(params: ListPayoutsParams = {}, options: RequestOptions = {}): Promise<PayoutList> {
    return this.request<PayoutList>("GET", "/payouts", { query: { ...params }, signal: options.signal });
  }

  getPayoutStats(timezone?: string, options: RequestOptions = {}): Promise<PayoutStats> {
    return this.request<PayoutStats>("GET", "/payouts/stats", {
      query: { tz: timezone },
      signal: options.signal,
    });
  }

  // Polls until the payout reaches a final state. A network error, 429 or 5xx while polling is retried until the
  // timeout; any other error is thrown at once.
  async waitForPayout(payoutId: string, options: WaitForPayoutOptions = {}): Promise<Payout> {
    const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS);
    const interval = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    let lastState: string | null = null;
    for (;;) {
      options.signal?.throwIfAborted();
      const payout = await this.getPayout(payoutId, { signal: options.signal }).catch((error: unknown) => {
        if (error instanceof FliqError && error.retryable) return null;
        throw error;
      });
      if (payout && payout.state !== lastState) {
        lastState = payout.state;
        options.onUpdate?.(payout);
      }
      if (payout && isFinalState(payout.state)) return payout;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new FliqError({
          status: 0,
          code: "timeout",
          message: `Payout ${payoutId} did not reach a final state in time; last state ${lastState ?? "unknown"}.`,
        });
      }
      await sleep(Math.min(interval, remaining), options.signal);
    }
  }

  private async request<T>(
    method: Method,
    path: string,
    options: { body?: unknown; query?: Query; headers?: Record<string, string>; signal?: AbortSignal },
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${this.apiKey}`,
      ...options.headers,
    };
    if (options.body !== undefined) headers["content-type"] = "application/json";

    let response: Response;
    try {
      response = await this.fetcher(this.url(path, options.query), {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      throw new FliqError({ status: 0, code: "network_error", message: messageOf(error) });
    }
    return readResponse<T>(response);
  }

  private url(path: string, query: Query = {}): string {
    const search = new URLSearchParams();
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") search.set(name, String(value));
    }
    const encoded = search.toString();
    return `${this.baseUrl}${path}${encoded ? `?${encoded}` : ""}`;
  }
}

// Shared with the agent client in @fliqlabs/mcp, which signs its requests differently but reads answers the same way.
export async function readResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    if (response.ok) {
      throw new FliqError({
        status: response.status,
        code: "invalid_response",
        message: "The API sent a non-JSON body.",
      });
    }
  }
  if (response.ok) return body as T;

  const error = isRecord(body) && isRecord(body.error) ? body.error : {};
  const retryAfter = Number(response.headers.get("retry-after"));
  throw new FliqError({
    status: response.status,
    code: typeof error.code === "string" ? error.code : "invalid_response",
    message: typeof error.message === "string" ? error.message : `The API answered ${response.status}.`,
    body,
    traceId: response.headers.get("x-trace-id"),
    retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
  });
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "The request could not be sent.";
}
