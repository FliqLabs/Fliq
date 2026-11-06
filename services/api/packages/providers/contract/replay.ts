export type RecordedExchange = {
  method: string;
  path: string;
  status: number;
  body?: unknown;
};

export type ReplayedCall = { method: string; path: string; headers: Record<string, string>; body: string };

// Serves recorded provider responses so adapter tests run with no network and no keys (ARCH §9.2).
export function replayFetch(exchanges: readonly RecordedExchange[]) {
  const calls: ReplayedCall[] = [];
  const unmatched: string[] = [];

  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const method = init?.method ?? "GET";
    const path = url.pathname + url.search;
    calls.push({
      method,
      path,
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      body: typeof init?.body === "string" ? init.body : "",
    });
    const match = exchanges.find((exchange) => exchange.method === method && exchange.path === path);
    if (!match) {
      unmatched.push(`${method} ${path}`);
      throw new TypeError(`no recorded response for ${method} ${path}`);
    }
    const body = match.body === undefined ? "" : JSON.stringify(match.body);
    return new Response(body, { status: match.status });
  };

  return { fetch: fetchImpl as typeof fetch, calls, unmatched };
}
