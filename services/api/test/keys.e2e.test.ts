import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "../packages/db/src/crypto.js";
import { MAX_ACTIVE_KEYS } from "../apps/api/src/keys.js";
import { createHarness, databaseEnabled, type Developer } from "./dashboard.harness.js";

describe.skipIf(!databaseEnabled)("API keys against a real database", () => {
  const harness = createHarness();
  const { call, database } = harness;
  let alice: Developer;
  let bob: Developer;

  beforeAll(async () => {
    alice = await harness.signUp("keys-alice");
    bob = await harness.signUp("keys-bob");
  }, 60_000);
  afterAll(() => harness.cleanUp(), 60_000);

  const create = (developer: Developer, payload: object) =>
    call("POST", "/keys", { payload, token: developer.access });

  it("creates a key, shows it once and stores only its hash", async () => {
    const created = await create(alice, { name: "CI server", environment: "test" });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body).toMatchObject({
      name: "CI server",
      environment: "test",
      status: "active",
      last_used_at: null,
    });
    expect(body.key).toMatch(/^rt_test_[A-Za-z0-9_-]{43}$/);
    expect(body.masked).toBe(`${body.key.slice(0, 12)}...${body.key.slice(-4)}`);

    const stored = await database.apiKey.findUniqueOrThrow({ where: { id: body.key_id } });
    expect(stored.keyHash).toBe(sha256Hex(body.key));
    expect(JSON.stringify(stored)).not.toContain(body.key);

    const listed = (await call("GET", "/keys", { token: alice.access })).json();
    expect(listed.items.map((item: { key_id: string }) => item.key_id)).toContain(body.key_id);
    expect(JSON.stringify(listed)).not.toContain(body.key);
    expect(listed.items.every((item: object) => !("key" in item))).toBe(true);

    const trail = await database.auditEvent.findMany({ where: { targetId: body.key_id } });
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({
      action: "api_key.created",
      actorUserId: alice.userId,
      workspaceId: alice.workspaceId,
    });
    expect(JSON.stringify(trail)).not.toContain(body.key);
  });

  it("refuses live keys before KYB and keys of another deployment", async () => {
    const live = await create(alice, { name: "Live", environment: "live" });
    expect(live.statusCode).toBe(403);
    expect(live.json().error.code).toBe("live_not_enabled");

    const access = (await call("GET", "/workspaces/current/live-access", { token: alice.access })).json();
    expect(access).toEqual({
      live_enabled: false,
      kyb_status: "not_started",
      deployment_environment: "test",
      test_keys_allowed: true,
      live_keys_allowed: false,
    });
    expect(
      await database.apiKey.count({ where: { workspaceId: alice.workspaceId, environment: "live" } }),
    ).toBe(0);
  });

  it("validates names and unknown fields", async () => {
    expect((await create(alice, { name: "   ", environment: "test" })).statusCode).toBe(400);
    expect((await create(alice, { name: "x".repeat(65), environment: "test" })).statusCode).toBe(400);
    expect((await create(alice, { name: "ok", environment: "test", scopes: ["admin"] })).statusCode).toBe(
      400,
    );
    expect((await create(alice, { name: "ok", environment: "prod" })).statusCode).toBe(400);
  });

  it("authenticates developer endpoints with a key and keeps keys away from account endpoints", async () => {
    const key = (await create(alice, { name: "Agent", environment: "test" })).json();
    const payouts = await call("GET", "/payouts", { token: key.key });
    expect(payouts.statusCode).toBe(200);
    expect(
      (await database.apiKey.findUniqueOrThrow({ where: { id: key.key_id } })).lastUsedAt,
    ).not.toBeNull();

    for (const [method, url] of [
      ["GET", "/keys"],
      ["GET", "/me"],
      ["POST", "/auth/logout"],
      ["GET", "/workspaces/current"],
    ] as const) {
      const reply = await call(method, url, { token: key.key });
      expect(reply.statusCode, url).toBe(403);
    }
    expect(
      (await call("POST", "/keys", { payload: { name: "x", environment: "test" }, token: key.key }))
        .statusCode,
    ).toBe(403);
    expect((await call("GET", "/payouts", { token: `${key.key.slice(0, -1)}A` })).statusCode).toBe(401);
    expect(
      (await call("GET", "/payouts", { token: "rt_live_notarealkeynotarealkeynotarealkey000" })).statusCode,
    ).toBe(401);
  });

  it("stops a revoked key at once and audits the revocation once", async () => {
    const key = (await create(alice, { name: "Revoke me", environment: "test" })).json();
    expect((await call("GET", "/payouts", { token: key.key })).statusCode).toBe(200);

    expect((await call("DELETE", `/keys/${key.key_id}`, { token: alice.access })).statusCode).toBe(204);
    expect((await call("GET", "/payouts", { token: key.key })).statusCode).toBe(401);
    expect((await call("DELETE", `/keys/${key.key_id}`, { token: alice.access })).statusCode).toBe(204);
    expect(
      await database.auditEvent.count({ where: { targetId: key.key_id, action: "api_key.revoked" } }),
    ).toBe(1);

    const listed = (await call("GET", "/keys", { token: alice.access })).json();
    expect(listed.items.map((item: { key_id: string }) => item.key_id)).not.toContain(key.key_id);
  });

  it("rotates a key: the new one works, the old one stops", async () => {
    const old = (await create(alice, { name: "Rotate me", environment: "test" })).json();
    const rotated = await call("POST", `/keys/${old.key_id}/rotate`, { token: alice.access });
    expect(rotated.statusCode).toBe(201);
    const fresh = rotated.json();
    expect(fresh).toMatchObject({ name: "Rotate me", environment: "test", status: "active" });
    expect(fresh.key_id).not.toBe(old.key_id);
    expect((await call("GET", "/payouts", { token: old.key })).statusCode).toBe(401);
    expect((await call("GET", "/payouts", { token: fresh.key })).statusCode).toBe(200);
    expect((await call("POST", `/keys/${old.key_id}/rotate`, { token: alice.access })).statusCode).toBe(409);
  });

  it("never lets one workspace see, revoke or rotate another workspace's key", async () => {
    const key = (await create(alice, { name: "Private", environment: "test" })).json();
    expect((await call("DELETE", `/keys/${key.key_id}`, { token: bob.access })).statusCode).toBe(404);
    expect((await call("POST", `/keys/${key.key_id}/rotate`, { token: bob.access })).statusCode).toBe(404);
    const bobs = (await call("GET", "/keys", { token: bob.access })).json();
    expect(bobs.items.map((item: { key_id: string }) => item.key_id)).not.toContain(key.key_id);
    expect((await call("GET", "/payouts", { token: key.key })).statusCode).toBe(200);
  });

  it("holds the active key limit under concurrent creation", async () => {
    const active = await database.apiKey.count({ where: { workspaceId: bob.workspaceId, revokedAt: null } });
    const replies = await Promise.all(
      Array.from({ length: MAX_ACTIVE_KEYS + 5 - active }, (_, index) =>
        create(bob, { name: `k${index}`, environment: "test" }),
      ),
    );
    expect(replies.filter((reply) => reply.statusCode === 201)).toHaveLength(MAX_ACTIVE_KEYS - active);
    expect(
      replies
        .filter((reply) => reply.statusCode === 409)
        .every((reply) => reply.json().error.code === "limit_reached"),
    ).toBe(true);
    expect(await database.apiKey.count({ where: { workspaceId: bob.workspaceId, revokedAt: null } })).toBe(
      MAX_ACTIVE_KEYS,
    );
  }, 60_000);

  it("rejects audit rows being changed", async () => {
    await expect(
      database.auditEvent.updateMany({ where: { workspaceId: alice.workspaceId }, data: { action: "x" } }),
    ).rejects.toThrow(/append-only/);
  });
});

describe.skipIf(!databaseEnabled)("API keys in a production deployment", () => {
  const harness = createHarness({ config: { keyEnvironment: "live" } });
  let developer: Developer;
  beforeAll(async () => {
    developer = await harness.signUp("keys-prod");
  }, 60_000);
  afterAll(() => harness.cleanUp(), 60_000);

  it("refuses test keys there, including the workspace's own sandbox key", async () => {
    const created = await harness.call("POST", "/keys", {
      payload: { name: "t", environment: "test" },
      token: developer.access,
    });
    expect(created.statusCode).toBe(422);
    expect(created.json().error.code).toBe("environment_unavailable");
    expect((await harness.call("GET", "/payouts", { token: developer.sandboxKey })).statusCode).toBe(401);
  });
});
