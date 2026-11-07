import { readFileSync } from "node:fs";

export const API_KEY = "rt_test_7Kp2demo00c9Qe";
export const BASE_URL = "http://localhost:4000/v1";

export function fixture<T = Record<string, unknown>>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../../../spec/fixtures/${name}`, import.meta.url), "utf8")) as T;
}

export interface Recorded {
  method: string;
  path: string;
  search: string;
  headers: Record<string, string>;
  body: unknown;
}

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };
type Responder = Reply | ((request: Recorded) => Reply);

// A fetch that answers from a table of "METHOD /path" routes and records every request it was sent.
export function fakeApi(routes: Record<string, Responder | Responder[]>) {
  const requests: Recorded[] = [];
  const queues = new Map(
    Object.entries(routes).map(([route, reply]) => [route, Array.isArray(reply) ? [...reply] : reply]),
  );

  const fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v1/, "");
    const recorded: Recorded = {
      method: init.method ?? "GET",
      path,
      search: url.search,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    };
    requests.push(recorded);
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
