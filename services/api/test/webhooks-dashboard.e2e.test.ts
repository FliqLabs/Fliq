import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifySignature } from "../packages/webhooks/signature.js";
import type { OutboundRequest, Outcome } from "../packages/webhooks/transport.js";
import { unitOf } from "../apps/api/src/db.js";
import { MAX_ATTEMPTS, deliverDue, fanOut, type DeliveryDeps } from "../apps/api/src/webhook-delivery.js";
import { createHarness, databaseEnabled, type Developer } from "./dashboard.harness.js";

const PUBLIC = "93.184.215.14";
const resolve = async (host: string) => (host === "evil.example.com" ? ["10.0.0.7"] : [PUBLIC]);

describe.skipIf(!databaseEnabled)("webhook dashboard against a real database", () => {
  // Real time throughout: the delivery loop compares stored times with its own clock.
  const harness = createHarness({ webhookResolve: resolve, now: () => new Date() });
  const { call, database } = harness;
  const sent: OutboundRequest[] = [];
  let answer: (request: OutboundRequest) => Outcome = () => ({ status: 200 });
  const deps: DeliveryDeps = {
    unit: unitOf(database),
    config: harness.config,
    transport: async (request) => {
      sent.push(request);
      return answer(request);
    },
    now: () => new Date(),
    random: () => 0.5,
  };
  let alice: Developer;
  let bob: Developer;
  let endpoint: { endpoint_id: string; secret: string };
  let payoutId: string;

  const createEndpoint = (developer: Developer, payload: object) =>
    call("POST", "/webhook-endpoints", { payload, token: developer.access });

  async function createPayout(developer: Developer) {
    const quote = await call("POST", "/quotes", {
      payload: { token: "usdc", currency: "ngn", amount: "50.00", source_chain: "base" },
      token: developer.access,
    });
    const reply = await call("POST", "/payouts", {
      payload: {
        quote_id: quote.json().quote_id,
        account: { bank: "058", number: "0123456789" },
        refund_address: "frank.fliq.near",
      },
      token: developer.access,
      headers: { "idempotency-key": `po-${randomBytes(6).toString("hex")}` },
    });
    expect(reply.statusCode).toBe(201);
    return reply.json().payout_id as string;
  }

  const deliveriesOf = async (query: string, developer = alice) =>
    (await call("GET", `/webhook-deliveries${query}`, { token: developer.access })).json();

  beforeAll(async () => {
    alice = await harness.signUp("wh-alice");
    bob = await harness.signUp("wh-bob");
    deps.workspaceIds = [alice.workspaceId, bob.workspaceId];
  }, 60_000);
  afterAll(() => harness.cleanUp(), 60_000);

  it("registers an endpoint, shows its secret once and audits it", async () => {
    const created = await createEndpoint(alice, {
      url: "https://hooks.example.com/fliq",
      description: "Main",
    });
    expect(created.statusCode).toBe(201);
    endpoint = created.json();
    expect(endpoint.secret).toMatch(/^whsec_/);
    expect(created.json()).toMatchObject({
      status: "active",
      events: [],
      environment: "test",
      description: "Main",
    });

    const listed = (await call("GET", "/webhook-endpoints", { token: alice.access })).json();
    expect(listed.items).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(endpoint.secret);
    expect(listed.signing).toMatchObject({
      header: "fliq-signature",
      algorithm: "hmac-sha256",
      tolerance_seconds: 300,
    });
    const stored = await database.webhookEndpoint.findUniqueOrThrow({ where: { id: endpoint.endpoint_id } });
    expect(Buffer.from(stored.secretCipher).toString("utf8")).not.toContain(endpoint.secret);
    expect(
      await database.auditEvent.count({
        where: { targetId: endpoint.endpoint_id, action: "webhook_endpoint.created" },
      }),
    ).toBe(1);

    const onboarding = (await call("GET", "/onboarding", { token: alice.access })).json();
    expect(onboarding.steps.find((step: { id: string }) => step.id === "add_webhook").done).toBe(true);
  });

  it("refuses unsafe destinations and unknown event types", async () => {
    for (const url of [
      "http://hooks.example.com/x",
      "https://evil.example.com/x",
      "https://169.254.169.254/latest/meta-data",
      "https://localhost/x",
      "https://user:pw@hooks.example.com/x",
    ]) {
      const reply = await createEndpoint(alice, { url });
      expect(reply.statusCode, url).toBe(400);
    }
    expect(
      (await createEndpoint(alice, { url: "https://hooks.example.com/x", events: ["payout.paid"] }))
        .statusCode,
    ).toBe(400);
    const patched = await call("PATCH", `/webhook-endpoints/${endpoint.endpoint_id}`, {
      payload: { url: "https://evil.example.com/x" },
      token: alice.access,
    });
    expect(patched.statusCode).toBe(400);
  });

  it("keeps endpoints and deliveries inside their workspace, and away from API keys", async () => {
    const id = endpoint.endpoint_id;
    expect(
      (await call("PATCH", `/webhook-endpoints/${id}`, { payload: { enabled: false }, token: bob.access }))
        .statusCode,
    ).toBe(404);
    expect((await call("DELETE", `/webhook-endpoints/${id}`, { token: bob.access })).statusCode).toBe(404);
    expect((await call("POST", `/webhook-endpoints/${id}/test`, { token: bob.access })).statusCode).toBe(404);
    expect(
      (await call("POST", `/webhook-endpoints/${id}/rotate-secret`, { token: bob.access })).statusCode,
    ).toBe(404);
    expect((await call("GET", "/webhook-endpoints", { token: bob.access })).json().items).toEqual([]);
    expect((await call("GET", "/webhook-endpoints", { token: alice.sandboxKey })).statusCode).toBe(403);
  });

  it("fans each payout state change out once to subscribed endpoints and signs every delivery", async () => {
    const settledOnly = (
      await createEndpoint(alice, { url: "https://hooks.example.com/settled", events: ["payout.settled"] })
    ).json();
    payoutId = await createPayout(alice);
    await createPayout(bob);
    const states = (
      await database.payoutEvent.findMany({ where: { payoutId }, orderBy: { version: "asc" } })
    ).map((e) => e.toState);

    expect(await fanOut(deps)).toBeGreaterThanOrEqual(states.length);
    expect(await fanOut(deps)).toBe(0);
    const mine = await database.webhookDelivery.findMany({
      where: { payoutId },
      orderBy: { createdAt: "asc" },
    });
    expect(mine.map((delivery) => delivery.eventType).sort()).toEqual(
      states.map((state) => `payout.${state}`).sort(),
    );
    expect(mine.every((delivery) => delivery.endpointId === endpoint.endpoint_id)).toBe(true);
    expect(await database.webhookDelivery.count({ where: { endpointId: settledOnly.endpoint_id } })).toBe(0);

    sent.length = 0;
    await deliverDue(deps);
    const toAlice = sent.filter((request) => request.url === "https://hooks.example.com/fliq");
    expect(toAlice).toHaveLength(states.length);
    for (const request of toAlice) {
      const header = request.headers["fliq-signature"];
      expect(
        verifySignature({
          header,
          body: request.body,
          secret: endpoint.secret,
          now: Math.floor(Date.now() / 1000),
        }),
      ).toBe(true);
      const event = JSON.parse(request.body);
      expect(request.headers["fliq-event-id"]).toBe(event.id);
      expect(event).toMatchObject({
        livemode: false,
        data: { payout: { payout_id: payoutId, account_last4: "6789" } },
      });
      expect(request.body).not.toContain("0123456789");
    }
    expect(sent.every((request) => !request.url.includes("bob"))).toBe(true);
    const delivered = await deliveriesOf(`?payout_id=${payoutId}`);
    expect(
      delivered.items.every(
        (item: { status: string; attempts: number }) => item.status === "delivered" && item.attempts === 1,
      ),
    ).toBe(true);
  });

  it("retries a failed delivery on the schedule, then marks the endpoint failing, and recovers on success", async () => {
    answer = () => ({ status: 500 });
    const test = (
      await call("POST", `/webhook-endpoints/${endpoint.endpoint_id}/test`, { token: alice.access })
    ).json();
    const before = Date.now();
    await deliverDue(deps);
    const first = await database.webhookDelivery.findUniqueOrThrow({ where: { id: test.delivery_id } });
    expect(first).toMatchObject({
      status: "pending",
      attempts: 1,
      lastResponseStatus: 500,
      lastError: "http_500",
    });
    const delay = (first.nextAttemptAt as Date).getTime() - before;
    expect(delay).toBeGreaterThan(29_000);
    expect(delay).toBeLessThan(32_000);

    await database.webhookDelivery.update({
      where: { id: test.delivery_id },
      data: { attempts: MAX_ATTEMPTS - 1, nextAttemptAt: new Date(Date.now() - 1000) },
    });
    answer = () => ({ error: "timeout" });
    await deliverDue(deps);
    const last = (
      await call("GET", `/webhook-deliveries/${test.delivery_id}`, { token: alice.access })
    ).json();
    expect(last).toMatchObject({
      status: "failed",
      attempts: MAX_ATTEMPTS,
      error: "timeout",
      next_attempt_at: null,
      payout_id: null,
    });
    expect(last.history.map((attempt: { error: string }) => attempt.error)).toEqual(["http_500", "timeout"]);
    expect(last.payload).toMatchObject({ type: "test.webhook", data: { test: true } });
    expect(
      (await database.webhookEndpoint.findUniqueOrThrow({ where: { id: endpoint.endpoint_id } })).status,
    ).toBe("failing");

    answer = () => ({ status: 204 });
    await call("POST", `/webhook-endpoints/${endpoint.endpoint_id}/test`, { token: alice.access });
    await deliverDue(deps);
    expect(
      (await database.webhookEndpoint.findUniqueOrThrow({ where: { id: endpoint.endpoint_id } })).status,
    ).toBe("active");
  });

  it("replays with the same event id as a new delivery and never re-runs the payout", async () => {
    const original = (await deliveriesOf(`?payout_id=${payoutId}&event_type=payout.created`)).items[0];
    const eventsBefore = await database.payoutEvent.count({ where: { payoutId } });
    const payoutBefore = await database.payout.findUniqueOrThrow({ where: { id: payoutId } });
    const journalBefore = await database.journalEntry.count({ where: { payoutId } });

    const replay = await call("POST", `/webhook-deliveries/${original.delivery_id}/replay`, {
      token: alice.access,
    });
    expect(replay.statusCode).toBe(202);
    expect(replay.json()).toMatchObject({
      event_id: original.event_id,
      replay_of: original.delivery_id,
      status: "pending",
    });
    expect(replay.json().delivery_id).not.toBe(original.delivery_id);
    expect(
      (await call("POST", `/webhook-deliveries/${original.delivery_id}/replay`, { token: bob.access }))
        .statusCode,
    ).toBe(404);

    sent.length = 0;
    await deliverDue(deps);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]?.body as string).id).toBe(original.event_id);
    expect(await database.payoutEvent.count({ where: { payoutId } })).toBe(eventsBefore);
    expect(await database.journalEntry.count({ where: { payoutId } })).toBe(journalBefore);
    expect((await database.payout.findUniqueOrThrow({ where: { id: payoutId } })).version).toBe(
      payoutBefore.version,
    );
    expect(await fanOut(deps)).toBe(0);
    expect(
      await database.auditEvent.count({
        where: { targetId: original.delivery_id, action: "webhook_delivery.replayed" },
      }),
    ).toBe(1);
  });

  it("filters and pages the delivery history", async () => {
    const all = await deliveriesOf("?limit=100");
    expect(all.items.length).toBeGreaterThan(3);
    const page = await deliveriesOf("?limit=2");
    expect(page.items).toHaveLength(2);
    const next = await deliveriesOf(`?limit=2&cursor=${page.next_cursor}`);
    expect(next.items[0].delivery_id).not.toBe(page.items[1].delivery_id);
    expect(
      (await deliveriesOf("?status=failed")).items.every(
        (item: { status: string }) => item.status === "failed",
      ),
    ).toBe(true);
    expect(
      (await deliveriesOf("?event_type=test.webhook")).items.every(
        (i: { payout_id: null }) => i.payout_id === null,
      ),
    ).toBe(true);
    expect((await deliveriesOf(`?endpoint_id=${endpoint.endpoint_id}`)).items.length).toBe(all.items.length);
    expect((await deliveriesOf("?from=2999-01-01T00:00:00Z")).items).toEqual([]);
    expect((await call("GET", "/webhook-deliveries?status=lost", { token: alice.access })).statusCode).toBe(
      400,
    );
    expect((await call("GET", "/webhook-deliveries?cursor=bad", { token: alice.access })).statusCode).toBe(
      400,
    );
    expect(
      (await deliveriesOf("", bob)).items.every(
        (item: { endpoint_id: string }) => item.endpoint_id !== endpoint.endpoint_id,
      ),
    ).toBe(true);
  });

  it("signs with the old and the new secret during a rotation", async () => {
    const rotated = (
      await call("POST", `/webhook-endpoints/${endpoint.endpoint_id}/rotate-secret`, { token: alice.access })
    ).json();
    expect(rotated.secret).not.toBe(endpoint.secret);
    sent.length = 0;
    await call("POST", `/webhook-endpoints/${endpoint.endpoint_id}/test`, { token: alice.access });
    await deliverDue(deps);
    const request = sent[0] as OutboundRequest;
    const now = Math.floor(Date.now() / 1000);
    for (const secret of [rotated.secret, endpoint.secret]) {
      expect(
        verifySignature({ header: request.headers["fliq-signature"], body: request.body, secret, now }),
      ).toBe(true);
    }
  });

  it("stops deliveries to a disabled endpoint and refuses replays to it", async () => {
    const disabled = await call("PATCH", `/webhook-endpoints/${endpoint.endpoint_id}`, {
      payload: { enabled: false },
      token: alice.access,
    });
    expect(disabled.json().status).toBe("disabled");
    const anyDelivery = (await deliveriesOf("?limit=1")).items[0];
    expect(
      (await call("POST", `/webhook-deliveries/${anyDelivery.delivery_id}/replay`, { token: alice.access }))
        .statusCode,
    ).toBe(409);
    expect(
      (await call("POST", `/webhook-endpoints/${endpoint.endpoint_id}/test`, { token: alice.access }))
        .statusCode,
    ).toBe(409);
    await call("PATCH", `/webhook-endpoints/${endpoint.endpoint_id}`, {
      payload: { enabled: true },
      token: alice.access,
    });
  });

  it("limits replays and test events per workspace", async () => {
    const replies = [];
    for (let index = 0; index < 32; index++) {
      replies.push(
        (await call("POST", `/webhook-endpoints/${endpoint.endpoint_id}/test`, { token: alice.access }))
          .statusCode,
      );
    }
    expect(replies.filter((status) => status === 429).length).toBeGreaterThan(0);
    expect(replies.filter((status) => status !== 202 && status !== 429)).toEqual([]);
  }, 60_000);

  it("deletes an endpoint: hidden, audited and no longer delivered to", async () => {
    expect(
      (await call("DELETE", `/webhook-endpoints/${endpoint.endpoint_id}`, { token: alice.access }))
        .statusCode,
    ).toBe(204);
    const listed = (await call("GET", "/webhook-endpoints", { token: alice.access })).json();
    expect(listed.items.map((item: { endpoint_id: string }) => item.endpoint_id)).not.toContain(
      endpoint.endpoint_id,
    );
    sent.length = 0;
    await deliverDue(deps);
    expect(sent.filter((request) => request.url === "https://hooks.example.com/fliq")).toEqual([]);
    expect(
      await database.auditEvent.count({
        where: { targetId: endpoint.endpoint_id, action: "webhook_endpoint.deleted" },
      }),
    ).toBe(1);
  });
});
