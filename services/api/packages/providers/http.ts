import { ProviderError, providerReason, type ProviderOperation } from "./errors";
import type { ProviderId } from "./types";

export const OPERATION_TIMEOUT_MS: Record<Exclude<ProviderOperation, "parseWebhook">, number> = {
  quote: 1_500,
  createOrder: 10_000,
  getOrder: 10_000,
  verifyAccount: 15_000,
  institutions: 10_000,
  health: 5_000,
  balance: 5_000,
};

// ARCH §9.2: only reads are retried; createOrder is resolved by re-query, never by retry.
const RETRIED_READS: ReadonlySet<ProviderOperation> = new Set(["quote", "getOrder", "institutions"]);
const MAX_READ_ATTEMPTS = 3;
const BACKOFF_MS = 50;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type HttpRequest = {
  operation: Exclude<ProviderOperation, "parseWebhook">;
  method: HttpMethod;
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  acceptStatuses?: number[];
  // Lets one operation that needs several calls (e.g. initialize then finalize) share a single budget.
  deadline?: number;
};

export type HttpResponse = { status: number; body: unknown };

export type SignableRequest = { method: HttpMethod; pathWithQuery: string; body: string };

export type ProviderHttpOptions = {
  provider: ProviderId;
  baseUrl: string;
  maxConcurrent: number;
  fetch?: typeof fetch;
  authHeaders?: (request: SignableRequest) => Record<string, string>;
};

export type ProviderHttp = { request(request: HttpRequest): Promise<HttpResponse> };

export function createProviderHttp(options: ProviderHttpOptions): ProviderHttp {
  const doFetch = options.fetch ?? fetch;
  const bulkhead = createBulkhead(options.maxConcurrent);

  async function attempt(request: HttpRequest, deadline: number): Promise<HttpResponse> {
    const fail = (
      kind: "timeout" | "unavailable" | "rejected" | "invalid_response",
      detail: string,
      status?: number,
      reason?: string,
    ) => new ProviderError(options.provider, request.operation, kind, detail, status, reason);

    const remaining = deadline - Date.now();
    if (remaining <= 0) throw fail("timeout", "deadline passed before the call");
    const release = await bulkhead.acquire(remaining).catch(() => {
      throw fail("timeout", "waited too long for a connection slot");
    });
    try {
      const pathWithQuery = request.path + queryString(request.query);
      const body = request.body === undefined ? "" : JSON.stringify(request.body);
      const headers: Record<string, string> = {
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
        ...options.authHeaders?.({ method: request.method, pathWithQuery, body }),
        ...request.headers,
      };
      let response: Response;
      try {
        response = await doFetch(options.baseUrl + pathWithQuery, {
          method: request.method,
          headers,
          ...(body ? { body } : {}),
          signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        });
      } catch (error) {
        const timedOut =
          error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        throw timedOut ? fail("timeout", "no response in time") : fail("unavailable", "network error");
      }
      const text = await response.text();
      if (!response.ok && !request.acceptStatuses?.includes(response.status)) {
        const transient = response.status >= 500 || response.status === 429;
        throw fail(transient ? "unavailable" : "rejected", `http ${response.status}`, response.status, providerReason(text));
      }
      return {
        status: response.status,
        body: parseJson(text, () => fail("invalid_response", "body is not JSON")),
      };
    } finally {
      release();
    }
  }

  return {
    async request(request) {
      const deadline = request.deadline ?? Date.now() + OPERATION_TIMEOUT_MS[request.operation];
      const attempts = RETRIED_READS.has(request.operation) ? MAX_READ_ATTEMPTS : 1;
      for (let n = 1; ; n++) {
        try {
          return await attempt(request, deadline);
        } catch (error) {
          const retry =
            n < attempts &&
            error instanceof ProviderError &&
            error.transient &&
            deadline - Date.now() > BACKOFF_MS * n;
          if (!retry) throw error;
          await sleep(BACKOFF_MS * n);
        }
      }
    },
  };
}

function queryString(query: HttpRequest["query"]): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, value);
  const text = params.toString();
  return text ? `?${text}` : "";
}

function parseJson(text: string, invalid: () => Error): unknown {
  if (text.trim() === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    throw invalid();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Bulkhead = { acquire(waitMs: number): Promise<() => void> };

// One pool per adapter so a slow provider cannot take every connection (ARCH §9.2).
export function createBulkhead(maxConcurrent: number): Bulkhead {
  let active = 0;
  const waiting: Array<() => void> = [];

  function release() {
    active--;
    const next = waiting.shift();
    if (next) next();
  }

  return {
    acquire(waitMs) {
      if (active < maxConcurrent) {
        active++;
        return Promise.resolve(release);
      }
      return new Promise((resolve, reject) => {
        const grant = () => {
          clearTimeout(timer);
          active++;
          resolve(release);
        };
        const timer = setTimeout(() => {
          const index = waiting.indexOf(grant);
          if (index >= 0) waiting.splice(index, 1);
          reject(new Error("bulkhead wait timed out"));
        }, waitMs);
        waiting.push(grant);
      });
    },
  };
}
