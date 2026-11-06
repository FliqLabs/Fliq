import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "../packages/db/src/ids.js";
import type { Limiter } from "../apps/api/src/rate-limit.js";
import { createHarness, databaseEnabled, type Developer, type Harness } from "./dashboard.harness.js";

async function payout(harness: Harness, token: string, clientReference?: string) {
  const quote = await harness.call("POST", "/quotes", {
    payload: { token: "usdc", currency: "ngn", amount: "50.00", source_chain: "base" },
    token,
  });
  const reply = await harness.call("POST", "/payouts", {
    payload: {
      quote_id: quote.json().quote_id,
      account: { bank: "058", number: "0123456789" },
      refund_address: "frank.fliq.near",
      ...(clientReference ? { client_reference: clientReference } : {}),
    },
    token,
    headers: { "idempotency-key": `po-${randomBytes(6).toString("hex")}` },
  });
  expect(reply.statusCode).toBe(201);
  return reply.json().payout_id as string;
}

async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  let value = await read();
  for (let attempt = 0; attempt < 40 && !done(value); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    value = await read();
  }
  return value;
}

describe.skipIf(!databaseEnabled)("payout history and usage against a real database", () => {
  const harness = createHarness({ now: () => new Date() });
  const { call, database } = harness;
  let alice: Developer;
  let bob: Developer;
  const ids: Record<string, string> = {};

  const list = async (query: string, developer = alice) => {
    const reply = await call("GET", `/payouts${query}`, { token: developer.access });
    expect(reply.statusCode, query).toBe(200);
    return reply.json() as { items: { payout_id: string; status: string }[]; next_cursor: string | null };
  };
  const idsOf = (page: { items: { payout_id: string }[] }) => page.items.map((item) => item.payout_id).sort();

  beforeAll(async () => {
    alice = await harness.signUp("hist-alice");
    bob = await harness.signUp("hist-bob");
    ids.pending = await payout(harness, alice.access, "order-1001");
    ids.settled = await payout(harness, alice.access);
    ids.refused = await payout(harness, alice.access);
    ids.failed = await payout(harness, alice.access, '=HYPERLINK("http://evil.example")');
    ids.bob = await payout(harness, bob.access);

    // Outcomes the sandbox cannot produce on its own, written the way the state machine records them.
    const settledBase = new Date();
    for (const [state, offset] of [
      ["deposit_seen", 0],
      ["paying_out", 5],
      ["settled", 21],
    ] as const) {
      const current = await database.payout.findUniqueOrThrow({ where: { id: ids.settled } });
      await database.payoutEvent.create({
        data: {
          id: newId("pev"),
          payoutId: ids.settled,
          fromState: current.state,
          toState: state,
          version: current.version + 1,
          cause: "test",
          createdAt: new Date(settledBase.getTime() + offset * 1000),
        },
      });
      await database.payout.update({
        where: { id: ids.settled },
        data: { state, version: current.version + 1 },
      });
    }
    await database.payout.update({
      where: { id: ids.refused },
      data: { state: "failed", failureReason: "vault_daily_cap" },
    });
    await database.payout.update({
      where: { id: ids.failed },
      data: { state: "failed", failureReason: "provider_rejected" },
    });
  }, 120_000);
  afterAll(() => harness.cleanUp(), 60_000);

  it("lists newest first with the dashboard status, reference and settlement time", async () => {
    const page = await list("");
    expect(page.items.map((item) => item.payout_id)).toEqual([
      ids.failed,
      ids.refused,
      ids.settled,
      ids.pending,
    ]);
    const settled = page.items.find((item) => item.payout_id === ids.settled) as Record<string, unknown>;
    expect(settled).toMatchObject({ status: "settled", seconds_to_bank: 21, account_last4: "6789" });
    expect(settled.settled_at).not.toBeNull();
    expect(page.items.find((item) => item.payout_id === ids.pending)).toMatchObject({
      status: "pending",
      client_reference: "order-1001",
      settled_at: null,
    });
    expect(JSON.stringify(page)).not.toContain("0123456789");
  });

  it("filters by status, provider, currency, time and exact search", async () => {
    expect(idsOf(await list("?status=refused"))).toEqual([ids.refused]);
    expect(idsOf(await list("?status=failed"))).toEqual([ids.failed]);
    expect(idsOf(await list("?status=settled,pending"))).toEqual([ids.pending, ids.settled].sort());
    expect(idsOf(await list("?q=order-1001"))).toEqual([ids.pending]);
    expect(idsOf(await list(`?q=${ids.settled}`))).toEqual([ids.settled]);
    expect(idsOf(await list("?q=order-10"))).toEqual([]);
    expect((await list("?currency=NGN")).items).toHaveLength(4);
    expect((await list("?currency=kes")).items).toHaveLength(0);
    expect((await list("?provider=mock")).items).toHaveLength(4);
    expect((await list("?provider=paycrest")).items).toHaveLength(0);
    expect((await list("?from=2999-01-01T00:00:00Z")).items).toHaveLength(0);
    expect((await list("?to=2000-01-01T00:00:00Z")).items).toHaveLength(0);
    expect((await call("GET", "/payouts?status=lost", { token: alice.access })).statusCode).toBe(400);
  });

  it("pages with filters kept across the cursor", async () => {
    const first = await list("?status=failed,refused,pending&limit=2");
    expect(first.items).toHaveLength(2);
    const second = await list(`?status=failed,refused,pending&limit=2&cursor=${first.next_cursor}`);
    expect([...idsOf(first), ...idsOf(second)].sort()).toEqual([ids.failed, ids.refused, ids.pending].sort());
    expect(second.next_cursor).toBeNull();
  });

  it("never shows one workspace another's payouts", async () => {
    expect(idsOf(await list("", bob))).toEqual([ids.bob]);
    expect(idsOf(await list(`?q=${ids.settled}`, bob))).toEqual([]);
    expect((await call("GET", `/payouts/${ids.settled}`, { token: bob.access })).statusCode).toBe(404);
  });

  it("exports CSV with the filters, masked accounts and neutralised formulas", async () => {
    const reply = await call("GET", "/payouts/export?status=failed,settled", { token: alice.access });
    expect(reply.statusCode).toBe(200);
    expect(reply.headers["content-type"]).toContain("text/csv");
    expect(reply.headers["content-disposition"]).toMatch(
      /^attachment; filename="fliq-payouts-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(reply.headers["x-export-truncated"]).toBe("false");
    const lines = reply.body.trim().split("\r\n");
    expect(lines[0]).toBe(
      "payout_id,client_reference,status,state,created_at,updated_at,settled_at,seconds_to_bank,amount,receive,currency,provider,bank_code,bank_name,account_last4,failure_reason",
    );
    expect(lines).toHaveLength(3);
    expect(reply.body).toContain('"\'=HYPERLINK(""http://evil.example"")"');
    expect(reply.body).not.toContain("0123456789");
    expect(reply.body).not.toMatch(/,=/);
    const bobs = await call("GET", "/payouts/export", { token: bob.access });
    expect(bobs.body).not.toContain(ids.settled);
    expect((await call("GET", "/payouts/export", { token: alice.sandboxKey })).statusCode).toBe(403);
  });

  it("counts API-key requests per key and day, and ignores dashboard sessions", async () => {
    const key = (
      await call("POST", "/keys", { payload: { name: "Usage", environment: "test" }, token: alice.access })
    ).json();
    await call("GET", "/payouts", { token: key.key });
    await call("GET", "/payouts", { token: key.key });
    await call("GET", "/payouts/po_missing", { token: key.key });
    await payout(harness, key.key);
    await call("GET", "/payouts", { token: alice.access });

    const usage = await eventually(
      async () => (await call("GET", "/usage", { token: alice.access })).json(),
      (value) => value.keys.find((item: { key_id: string }) => item.key_id === key.key_id)?.requests === 5,
    );
    const mine = usage.keys.find((item: { key_id: string }) => item.key_id === key.key_id);
    expect(mine).toMatchObject({
      requests: 5,
      succeeded: 4,
      failed: 1,
      rate_limited: 0,
      payouts_created: 1,
      name: "Usage",
    });
    expect(JSON.stringify(usage)).not.toContain(key.key);
    expect(usage.daily).toHaveLength(7);
    expect(usage.daily.at(-1).date).toBe(new Date().toISOString().slice(0, 10));
    expect(usage.totals.requests).toBe(
      usage.daily.reduce((sum: number, day: { requests: number }) => sum + day.requests, 0),
    );
    expect(usage.rate_limit).toEqual({ requests_per_minute: 300, scope: "per key" });

    const bobs = (await call("GET", "/usage?days=30", { token: bob.access })).json();
    expect(bobs.totals.requests).toBe(0);
    expect(bobs.daily).toHaveLength(30);
    expect((await call("GET", "/usage?days=91", { token: alice.access })).statusCode).toBe(400);
    expect((await call("GET", "/usage", { token: key.key })).statusCode).toBe(403);
  });
});

describe.skipIf(!databaseEnabled)("usage of rate-limited keys", () => {
  const refuseAll: Limiter = {
    take: async () => ({ allowed: false, limit: 300, remaining: 0, resetSeconds: 1 }),
  };
  const harness = createHarness({ now: () => new Date(), limiter: refuseAll });
  const open = createHarness({ now: () => new Date() });
  let developer: Developer;
  beforeAll(async () => {
    developer = await open.signUp("hist-limited");
  }, 60_000);
  afterAll(async () => {
    await open.cleanUp();
    await harness.database.$disconnect();
    await harness.app.close();
  }, 60_000);

  it("counts a refused request against the key that sent it", async () => {
    expect((await harness.call("GET", "/payouts", { token: developer.sandboxKey })).statusCode).toBe(429);
    expect(
      (await harness.call("GET", "/payouts", { token: "rt_test_unknownunknownunknownunknownunknown00" }))
        .statusCode,
    ).toBe(429);
    const row = await eventually(
      () => harness.database.apiUsageDaily.findFirst({ where: { workspaceId: developer.workspaceId } }),
      (value) => value?.rateLimited === 1,
    );
    expect(row).toMatchObject({ requests: 1, rateLimited: 1, succeeded: 0, failed: 0 });
  });
});
