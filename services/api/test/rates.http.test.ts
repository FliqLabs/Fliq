import { describe, expect, it } from "vitest";
import { buildApp } from "../apps/api/src/app.js";
import { loadConfig } from "../apps/api/src/config.js";
import type { Unit } from "../apps/api/src/db.js";
import { createHandlers } from "../apps/api/src/handlers.js";
import { sandboxAdapters } from "../apps/api/src/sandbox.js";
import { DEFAULT_ROUTING_CONFIG, NO_SIGNALS } from "../packages/domain/routing.js";

const enabled = Boolean(process.env.FLIQ_ACCESS_SECRET);

describe.skipIf(!enabled)("GET /v1/rates/{token}/{currency}", () => {
  const config = loadConfig();
  const unit = (async () => {
    throw new Error("rates must not touch the database");
  }) as unknown as Unit;
  const app = buildApp({
    config,
    unit,
    handlers: createHandlers({
      config,
      unit,
      email: { sendSignInLink: async () => undefined },
      provisioner: undefined as never,
      vault: undefined as never,
      quotes: { adapters: sandboxAdapters(), routing: DEFAULT_ROUTING_CONFIG, signals: NO_SIGNALS, now: () => new Date() },
      payouts: undefined as never,
    }),
  });

  it("answers without a session and says how long the rate may be cached", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/rates/usdc/ngn" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=10");
    expect(res.json()).toMatchObject({ token: "usdc", currency: "ngn", provider: "mock" });
  });

  it("refuses a corridor the spec does not list", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/rates/usdc/eur" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_request");
  });
});
