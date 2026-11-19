import { describe, expect, it } from "vitest";
import type { VaultDeposit } from "@prisma/client";
import { createAlerts, createBurst } from "../apps/api/src/alerts.js";
import { buildApp } from "../apps/api/src/app.js";
import type { Config } from "../apps/api/src/config.js";
import { depositProblem } from "../apps/api/src/deposits.js";
import { ApiError } from "../apps/api/src/errors.js";

const deposit = (overrides: Partial<VaultDeposit>): VaultDeposit =>
  ({
    id: "dep_1",
    state: "refunded",
    token: "usdc",
    chain: "solana",
    account: "someone.fliqaccount.near",
    decimals: 6,
    refundedUnits: 1_632_606n,
    refundReason: "QUOTE_EXPIRED",
    ...overrides,
  }) as VaultDeposit;

describe("telling the team", () => {
  it("names a deposit that was just refunded, with the amount and the reason", () => {
    expect(depositProblem("bridging", deposit({}))).toBe(
      "deposit dep_1 refunded (QUOTE_EXPIRED): 1.632606 USDC from solana went back to someone.fliqaccount.near. The app returns it to their vault.",
    );
    expect(depositProblem("bridging", deposit({ state: "failed" }))).toContain("deposit dep_1 failed");
  });

  it("says nothing for a deposit that landed or was already refunded", () => {
    expect(depositProblem("bridging", deposit({ state: "landed" }))).toBeNull();
    expect(depositProblem("refunded", deposit({}))).toBeNull();
  });

  it("fires once several failures come close together, not on one", () => {
    let at = 0;
    const burst = createBurst(3, 600_000, () => at);
    expect([burst(), burst()]).toEqual([false, false]);
    at = 700_000;
    expect(burst()).toBe(false);
    expect([burst(), burst()]).toEqual([false, true]);
    expect(burst()).toBe(false);
  });

  it("sends a line once in half an hour", async () => {
    const sent: string[] = [];
    let at = 0;
    const alert = createAlerts({ config: { botToken: "t", chatId: "c" }, log: () => undefined, now: () => at, send: async (_c, text) => void sent.push(text) });
    alert("x");
    alert("x");
    at = 31 * 60_000;
    alert("x");
    expect(sent).toEqual(["fliq: x", "fliq: x"]);
  });
});

describe("server errors reach the team", () => {
  const config = { accessSecret: Buffer.alloc(32) } as unknown as Config;
  const unit = (async () => undefined) as never;

  it("alerts on a crash and on cash-out quotes failing for several people", async () => {
    const lines: string[] = [];
    let crash = true;
    const app = buildApp({
      config,
      unit,
      alert: (line) => lines.push(line),
      handlers: {
        getHealth: async () => {
          throw new TypeError("boom");
        },
        getRate: async () => {
          if (crash) throw new ApiError(422, "no_route", "No provider can pay this corridor right now.");
          return { status: 200, body: {} };
        },
      },
    });
    expect((await app.inject({ method: "GET", url: "/v1/health" })).statusCode).toBe(500);
    expect(lines).toEqual(["500 on GET /v1/health: TypeError: boom"]);
    for (let i = 0; i < 3; i += 1) await app.inject({ method: "GET", url: "/v1/rates/usdc/ngn" });
    expect(lines[1]).toContain("cash-out quotes are failing");
    crash = false;
    expect(lines).toHaveLength(2);
    await app.close();
  });
});
