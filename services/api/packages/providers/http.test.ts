import { describe, expect, it } from "vitest";
import { ProviderError } from "./errors";
import { createBulkhead, createProviderHttp } from "./http";

type Reply = { status: number; body?: string } | "network_error" | "hang";

function scriptedFetch(replies: Reply[]) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const reply = replies.shift() ?? { status: 200, body: "{}" };
    if (reply === "network_error") throw new TypeError("fetch failed");
    if (reply === "hang") {
      return new Promise((_, reject) =>
        init.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError"))),
      );
    }
    return new Response(reply.body ?? "", { status: reply.status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function client(fetchImpl: typeof fetch) {
  return createProviderHttp({
    provider: "mock",
    baseUrl: "https://provider.test",
    maxConcurrent: 2,
    fetch: fetchImpl,
    authHeaders: ({ method, pathWithQuery }) => ({ "x-signed": `${method} ${pathWithQuery}` }),
  });
}

describe("provider http", () => {
  it("sends JSON with auth headers and a query string", async () => {
    const { fetchImpl, calls } = scriptedFetch([{ status: 200, body: '{"ok":true}' }]);
    const response = await client(fetchImpl).request({
      operation: "getOrder",
      method: "GET",
      path: "/orders",
      query: { reference: "po_1", skip: undefined },
    });
    expect(response.body).toEqual({ ok: true });
    expect(calls[0]?.url).toBe("https://provider.test/orders?reference=po_1");
    expect((calls[0]?.init.headers as Record<string, string>)["x-signed"]).toBe("GET /orders?reference=po_1");
  });

  it("never retries createOrder", async () => {
    const { fetchImpl, calls } = scriptedFetch([{ status: 503 }, { status: 200, body: "{}" }]);
    await expect(
      client(fetchImpl).request({ operation: "createOrder", method: "POST", path: "/orders", body: {} }),
    ).rejects.toMatchObject({ kind: "unavailable" });
    expect(calls).toHaveLength(1);
  });

  it("retries transient failures on reads", async () => {
    const { fetchImpl, calls } = scriptedFetch([
      "network_error",
      { status: 502 },
      { status: 200, body: '{"id":1}' },
    ]);
    const response = await client(fetchImpl).request({
      operation: "getOrder",
      method: "GET",
      path: "/orders/1",
    });
    expect(response.body).toEqual({ id: 1 });
    expect(calls).toHaveLength(3);
  });

  it("does not retry a client error", async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { status: 400, body: '{"message":"bad account 0123456789"}' },
    ]);
    const error = await client(fetchImpl)
      .request({ operation: "institutions", method: "GET", path: "/banks" })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).kind).toBe("rejected");
    expect((error as ProviderError).message).not.toContain("0123456789");
    expect(calls).toHaveLength(1);
  });

  it("keeps the provider's reason for a refusal, with account numbers masked", async () => {
    const body = '{"status":"error","message":"Validation failed","data":[{"field":"refundAddress","message":"invalid address"},{"field":"accountIdentifier","message":"0123456789 is not valid"}]}';
    const { fetchImpl } = scriptedFetch([{ status: 400, body }]);
    const error = (await client(fetchImpl)
      .request({ operation: "createOrder", method: "POST", path: "/orders", body: {} })
      .catch((caught: unknown) => caught)) as ProviderError;
    expect(error.httpStatus).toBe(400);
    expect(error.reason).toBe("Validation failed; refundAddress: invalid address; accountIdentifier: [number] is not valid");
    expect(error.message).not.toContain("Validation");
  });

  it("returns accepted non-2xx statuses to the adapter", async () => {
    const { fetchImpl } = scriptedFetch([{ status: 404, body: "" }]);
    const response = await client(fetchImpl).request({
      operation: "getOrder",
      method: "GET",
      path: "/orders/x",
      acceptStatuses: [404],
    });
    expect(response).toEqual({ status: 404, body: null });
  });

  it("times out at the operation budget", async () => {
    const { fetchImpl } = scriptedFetch(["hang", "hang", "hang"]);
    const started = Date.now();
    await expect(
      client(fetchImpl).request({ operation: "quote", method: "POST", path: "/quote", body: {} }),
    ).rejects.toMatchObject({ kind: "timeout" });
    expect(Date.now() - started).toBeLessThan(2_500);
  });

  it("rejects a 2xx body that is not JSON", async () => {
    const { fetchImpl } = scriptedFetch([{ status: 200, body: "<html>" }]);
    await expect(
      client(fetchImpl).request({ operation: "health", method: "GET", path: "/" }),
    ).rejects.toMatchObject({ kind: "invalid_response" });
  });
});

describe("bulkhead", () => {
  it("queues beyond the limit and times out a waiter", async () => {
    const bulkhead = createBulkhead(1);
    const release = await bulkhead.acquire(10);
    await expect(bulkhead.acquire(20)).rejects.toThrow();
    release();
    const again = await bulkhead.acquire(10);
    again();
  });
});
