import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifySignature } from "../packages/webhooks/signature.js";
import type { OutboundRequest } from "../packages/webhooks/transport.js";
import { unitOf } from "../apps/api/src/db.js";
import { deliverDue, fanOut, type DeliveryDeps } from "../apps/api/src/webhook-delivery.js";
import { createHarness, databaseEnabled, type Developer } from "./dashboard.harness.js";

// The dashboard's acceptance path in one run: key, payout through the key, history, receipt, webhook, replay, usage.
// The provider is the in-process sandbox mock and the receiver is a recorder, so no funds or network are involved.
describe.skipIf(!databaseEnabled)("developer dashboard acceptance", () => {
  const harness = createHarness({ now: () => new Date(), webhookResolve: async () => ["93.184.215.14"] });
  const { call } = harness;
  const received: OutboundRequest[] = [];
  const deps: DeliveryDeps = {
    unit: unitOf(harness.database),
    config: harness.config,
    transport: async (request: OutboundRequest) => (received.push(request), { status: 200 }),
    now: () => new Date(),
  };
  let developer: Developer;
  beforeAll(async () => {
    developer = await harness.signUp("accept");
    deps.workspaceIds = [developer.workspaceId];
  }, 60_000);
  afterAll(() => harness.cleanUp(), 60_000);

  it("goes from a new key to a replayed webhook and counted usage", async () => {
    const key = (
      await call("POST", "/keys", {
        payload: { name: "Judge", environment: "test" },
        token: developer.access,
      })
    ).json();
    const endpoint = (
      await call("POST", "/webhook-endpoints", {
        payload: { url: "https://receiver.example.com/fliq" },
        token: developer.access,
      })
    ).json();

    const quote = await call("POST", "/quotes", {
      payload: { token: "usdc", currency: "ngn", amount: "50.00", source_chain: "base" },
      token: key.key,
    });
    expect(quote.statusCode).toBe(200);
    const created = await call("POST", "/payouts", {
      payload: {
        quote_id: quote.json().quote_id,
        account: { bank: "058", number: "0123456789" },
        refund_address: "0x1111111111111111111111111111111111111111",
      },
      token: key.key,
      headers: { "idempotency-key": "acceptance-1" },
    });
    expect(created.statusCode).toBe(201);
    const payoutId = created.json().payout_id;

    const history = (await call("GET", `/payouts?q=${payoutId}`, { token: developer.access })).json();
    expect(history.items[0]).toMatchObject({ payout_id: payoutId, status: "pending" });
    const receipt = await call("GET", `/payouts/${payoutId}`, { token: key.key });
    expect(receipt.json().history.length).toBeGreaterThan(0);

    await fanOut(deps);
    await deliverDue(deps);
    const deliveries = (
      await call("GET", `/webhook-deliveries?payout_id=${payoutId}`, { token: developer.access })
    ).json();
    expect(deliveries.items.length).toBeGreaterThan(0);
    expect(deliveries.items.every((item: { status: string }) => item.status === "delivered")).toBe(true);
    const first = received[0] as OutboundRequest;
    const now = Math.floor(Date.now() / 1000);
    expect(
      verifySignature({
        header: first.headers["fliq-signature"],
        body: first.body,
        secret: endpoint.secret,
        now,
      }),
    ).toBe(true);

    const replay = (
      await call("POST", `/webhook-deliveries/${deliveries.items[0].delivery_id}/replay`, {
        token: developer.access,
      })
    ).json();
    expect(replay.event_id).toBe(deliveries.items[0].event_id);
    await deliverDue(deps);
    expect(JSON.parse((received.at(-1) as OutboundRequest).body).id).toBe(replay.event_id);

    expect((await call("DELETE", `/keys/${key.key_id}`, { token: developer.access })).statusCode).toBe(204);
    expect((await call("GET", "/payouts", { token: key.key })).statusCode).toBe(401);

    const usage = (await call("GET", "/usage", { token: developer.access })).json();
    const judge = usage.keys.find((item: { key_id: string }) => item.key_id === key.key_id);
    expect(judge).toMatchObject({ status: "revoked", payouts_created: 1 });
    expect(judge.requests).toBeGreaterThanOrEqual(3);
  }, 60_000);
});
