import { describe, expect, it } from "vitest";
import { FliqClient, FliqError, isFinalState, type Payout } from "../src/index.js";
import { API_KEY, BASE_URL, fakeApi, fixture } from "./fake-api.js";

const quote = fixture("quote.usdc-ngn-50.json");
const created = fixture<Payout>("payout.created.json");
const settled = fixture<Payout>("payout.settled.json");
const verified = fixture("verify.gtbank-0123456789.json");

function client(routes: Parameters<typeof fakeApi>[0]) {
  const api = fakeApi(routes);
  return { api, fliq: new FliqClient({ apiKey: API_KEY, baseUrl: `${BASE_URL}/`, fetch: api.fetch }) };
}

describe("FliqClient", () => {
  it("quotes through POST /quotes with the key as a bearer token", async () => {
    const { api, fliq } = client({ "POST /quotes": { status: 200, body: quote } });
    const result = await fliq.quote({ token: "usdc", currency: "ngn", amount: "50.00" });
    expect(result).toEqual(quote);
    expect(api.requests[0]).toMatchObject({
      method: "POST",
      path: "/quotes",
      body: { token: "usdc", currency: "ngn", amount: "50.00" },
      headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
    });
  });

  it("verifies an account through POST /accounts/verify and lists institutions by country", async () => {
    const { api, fliq } = client({
      "POST /accounts/verify": { status: 200, body: verified },
      "GET /institutions": { status: 200, body: fixture("institutions.ng.json") },
    });
    expect(await fliq.verifyAccount({ bank: "058", number: "0123456789" })).toEqual(verified);
    const institutions = await fliq.institutions("ng");
    expect(institutions.items[0]).toMatchObject({ code: "058", name: "GTBank" });
    expect(api.requests[1]).toMatchObject({ method: "GET", path: "/institutions", search: "?country=ng" });
  });

  it("creates a payout with a generated Idempotency-Key, or the caller's own", async () => {
    const { api, fliq } = client({ "POST /payouts": { status: 201, body: created } });
    const request = { quote_id: "q_31ad77e0", account: { bank: "058", number: "0123456789" } };
    expect(await fliq.createPayout(request)).toEqual(created);
    await fliq.createPayout(request, { idempotencyKey: "order-42" });
    expect(api.requests[0]?.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(api.requests[1]?.headers["idempotency-key"]).toBe("order-42");
    expect(api.requests[0]?.body).toEqual(request);
  });

  it("lists payouts with only the filters that were given", async () => {
    const { api, fliq } = client({ "GET /payouts": { status: 200, body: fixture("payouts.list.json") } });
    const page = await fliq.listPayouts({ limit: 10, status: "settled,refused", cursor: undefined });
    expect(page.items[0]?.payout_id).toBe("po_9c2f71aa");
    expect(api.requests[0]?.search).toBe("?limit=10&status=settled%2Crefused");
  });

  it("turns the spec's error shape into a FliqError with status and code", async () => {
    const { fliq } = client({
      "GET /payouts/po_missing": {
        status: 401,
        body: fixture("error.unauthorized.json"),
        headers: { "x-trace-id": "trace-1" },
      },
    });
    const error = await fliq.getPayout("po_missing").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FliqError);
    expect(error).toMatchObject({
      status: 401,
      code: "unauthorized",
      message: "Missing or invalid API key.",
      traceId: "trace-1",
    });
  });

  it("exposes the fresh quote of quote_changed", async () => {
    const { fliq } = client({
      "POST /payouts": {
        status: 409,
        body: { error: { code: "quote_changed", message: "The rate moved. Nothing was sent." }, quote },
      },
    });
    const request = { quote_id: "q_31ad77e0", account: { bank: "058", number: "0123456789" } };
    const changed = (await fliq.createPayout(request).catch((caught: unknown) => caught)) as FliqError;
    expect(changed.code).toBe("quote_changed");
    expect(changed.quote?.quote_id).toBe("q_31ad77e0");
  });

  it("reports a failed fetch as a retryable network_error", async () => {
    const fliq = new FliqClient({
      apiKey: API_KEY,
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const error = (await fliq.getPayout("po_9c2f71aa").catch((caught: unknown) => caught)) as FliqError;
    expect(error).toMatchObject({ status: 0, code: "network_error", retryable: true });
  });
});

describe("waitForPayout", () => {
  it("polls through a transient 503 until the payout is final", async () => {
    const { api, fliq } = client({
      "GET /payouts/po_9c2f71aa": [
        { status: 200, body: created },
        { status: 503, body: { error: { code: "internal", message: "busy" } } },
        { status: 200, body: settled },
      ],
    });
    const seen: string[] = [];
    const payout = await fliq.waitForPayout("po_9c2f71aa", {
      intervalMs: 1,
      onUpdate: (p) => seen.push(p.state),
    });
    expect(payout.state).toBe("settled");
    expect(isFinalState(payout.state)).toBe(true);
    expect(seen).toEqual(["awaiting_deposit", "settled"]);
    expect(api.requests).toHaveLength(3);
  });

  it("gives up with a timeout error naming the last state", async () => {
    const { fliq } = client({ "GET /payouts/po_9c2f71aa": { status: 200, body: created } });
    const error = (await fliq
      .waitForPayout("po_9c2f71aa", { intervalMs: 5, timeoutMs: 20 })
      .catch((caught: unknown) => caught)) as FliqError;
    expect(error).toMatchObject({ code: "timeout" });
    expect(error.message).toContain("awaiting_deposit");
  });

  it("stops when the signal aborts", async () => {
    const { fliq } = client({ "GET /payouts/po_9c2f71aa": { status: 200, body: created } });
    const controller = new AbortController();
    const waiting = fliq.waitForPayout("po_9c2f71aa", { intervalMs: 1_000, signal: controller.signal });
    setTimeout(() => controller.abort(new Error("stopped")), 10);
    await expect(waiting).rejects.toThrow("stopped");
  });

  it("does not retry an error the caller must fix", async () => {
    const { api, fliq } = client({
      "GET /payouts/po_missing": {
        status: 404,
        body: { error: { code: "not_found", message: "No such payout." } },
      },
    });
    await expect(fliq.waitForPayout("po_missing", { intervalMs: 1 })).rejects.toMatchObject({
      code: "not_found",
    });
    expect(api.requests).toHaveLength(1);
  });
});
