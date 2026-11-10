import { readFileSync } from "node:fs";

export const API_KEY = "rt_test_7Kp2demo00c9Qe";
export const BASE_URL = "http://localhost:4000/v1";

export function fixture<T = Record<string, unknown>>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../../../spec/fixtures/${name}`, import.meta.url), "utf8")) as T;
}

export interface Recorded {
  method: string;
  path: string;
  // The path as the API sees it, /v1 included, with the query: what an agent signs.
  pathWithQuery: string;
  search: string;
  headers: Record<string, string>;
  body: unknown;
  rawBody: string;
}

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };
type Responder = Reply | ((request: Recorded) => Reply);

// The real API lets an API key reach only the developer endpoints, and an agent route only a signed request.
const KEY_FORBIDDEN = /^\/(relays|agent)(\/|$)/;
const AGENT_ROUTE = /^\/agent(\/|$)/;

// A fetch that answers from a table of "METHOD /path" routes and records every request it was sent.
export function fakeApi(routes: Record<string, Responder | Responder[]>) {
  const requests: Recorded[] = [];
  const queues = new Map(
    Object.entries(routes).map(([route, reply]) => [route, Array.isArray(reply) ? [...reply] : reply]),
  );

  const fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v1/, "");
    const rawBody = typeof init.body === "string" ? init.body : "";
    const recorded: Recorded = {
      method: init.method ?? "GET",
      path,
      pathWithQuery: `${url.pathname}${url.search}`,
      search: url.search,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: rawBody ? JSON.parse(rawBody) : undefined,
      rawBody,
    };
    requests.push(recorded);
    if (recorded.headers.authorization?.startsWith("Bearer ") && KEY_FORBIDDEN.test(path)) {
      return json({
        status: 403,
        body: {
          error: {
            code: "forbidden",
            message: "API keys cannot call this endpoint. Sign in to the dashboard instead.",
          },
        },
      });
    }
    if (AGENT_ROUTE.test(path) && !recorded.headers["x-fliq-signature"]) {
      return json({
        status: 401,
        body: {
          error: {
            code: "unauthorized",
            message: "Sign agent requests with X-Fliq-Agent, X-Fliq-Timestamp and X-Fliq-Signature.",
          },
        },
      });
    }
    const entry = queues.get(`${recorded.method} ${path}`);
    const responder = Array.isArray(entry) ? (entry.length > 1 ? entry.shift() : entry[0]) : entry;
    if (!responder)
      return json({ status: 404, body: { error: { code: "not_found", message: "No such route." } } });
    return json(typeof responder === "function" ? responder(recorded) : responder);
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

function json(reply: Reply): Response {
  return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
    status: reply.status,
    headers: { "content-type": "application/json", ...reply.headers },
  });
}
