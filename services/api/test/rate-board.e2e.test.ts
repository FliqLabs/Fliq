import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../apps/api/src/app.js";
import { loadConfig } from "../apps/api/src/config.js";
import { createDatabase, unitOf } from "../apps/api/src/db.js";
import { createHandlers } from "../apps/api/src/handlers.js";
import { createRateBoard } from "../apps/api/src/rate-board.js";
import { sandboxAdapters } from "../apps/api/src/sandbox.js";
import { DEFAULT_ROUTING_CONFIG, NO_SIGNALS } from "../packages/domain/routing.js";
import type { ProviderAdapter } from "../packages/providers/types.js";

// Throwaway local database only; Prisma loads .env, which may point at a shared one.
const enabled = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") && Boolean(process.env.FLIQ_ACCESS_SECRET);

describe.skipIf(!enabled)("the public rate board and its history", () => {
  if (!enabled) {
    it("needs DATABASE_URL pointing at a local database", () => {});
    return;
  }

  const database = createDatabase();
  const unit = unitOf(database);
  const config = loadConfig();
  const currency = "ngn";
  const sandbox = sandboxAdapters()[0] as ProviderAdapter;
  const trouble = { busha: false };
  const as = (id: "paycrest" | "busha", markup: bigint): ProviderAdapter => ({
    ...sandbox,
    id,
    capabilities: () => ({ ...sandbox.capabilities(), provider: id }),
    async quote(request) {
      if (id === "busha" && trouble.busha) throw new Error("busha is not answering");
      const quote = await sandbox.quote(request);
      return { ...quote, provider: id, receiveMinorUnits: quote.receiveMinorUnits - markup };
    },
  });
  const clock = { at: new Date("2026-11-07T10:00:30Z") };
  const quotes = { adapters: [as("paycrest", 0n), as("busha", 5_000n)], routing: DEFAULT_ROUTING_CONFIG, signals: NO_SIGNALS, now: () => clock.at };
  const board = createRateBoard(quotes, unit);
  const app = buildApp({
    config,
    unit,
    handlers: createHandlers({
      config,
      unit,
      email: { sendSignInLink: async () => undefined },
      provisioner: undefined as never,
      vault: undefined as never,
      quotes,
      payouts: undefined as never,
      rateBoard: board,
    }),
  });

  beforeAll(async () => {
    await app.ready();
    await unit((tx) => tx.rateSample.deleteMany({ where: { currency: { in: ["ngn", "kes"] } } }));
  });

  afterAll(async () => {
    await unit((tx) => tx.rateSample.deleteMany({ where: { currency: { in: ["ngn", "kes"] } } }));
    await database.$disconnect();
  });

  const get = (url: string) => app.inject({ method: "GET", url });

  it("shows every quoting provider best first, without a session, with fees and the effective rate", async () => {
    const reply = await get(`/v1/rates/usdc/${currency}/providers`);
    expect(reply.statusCode, reply.body).toBe(200);
    expect(reply.headers["cache-control"]).toBe("public, max-age=10");
    const body = reply.json();
    expect(body).toMatchObject({ token: "usdc", currency, amount: "100.00", best: "paycrest" });
    expect(body.providers.map((row: { provider: string }) => row.provider)).toEqual(["paycrest", "busha"]);
    const [best, next] = body.providers;
    expect(best).toMatchObject({ status: "live", not_offered_reason: null });
    expect(best.rate).toBeGreaterThan(next.rate);
    expect(best.rate_before_fees).toBeGreaterThanOrEqual(best.rate);
    expect(best.fee).toBeGreaterThanOrEqual(0);
    expect(best.fee_percent).toBeGreaterThanOrEqual(0);
  });

  it("samples every provider at one time, and shows a provider that stops answering as stale at its last rate", async () => {
    expect(await board.sample()).toBeGreaterThanOrEqual(2);
    const rows = await unit((tx) => tx.rateSample.findMany({ where: { currency, token: "usdc" } }));
    expect(new Set(rows.map((row) => row.sampledAt.getTime())).size).toBe(1);
    const busha = rows.find((row) => row.provider === "busha");

    trouble.busha = true;
    clock.at = new Date(clock.at.getTime() + 11_000);
    try {
      const body = (await get(`/v1/rates/usdc/${currency}/providers`)).json();
      expect(body.providers.at(-1)).toMatchObject({
        provider: "busha",
        status: "stale",
        rate: Number(busha?.rate),
        updated_at: busha?.sampledAt.toISOString(),
        not_offered_reason: "error",
      });
    } finally {
      trouble.busha = false;
    }
  });

  it("charts the average best and worst of each period, oldest first", async () => {
    await unit((tx) => tx.rateSample.deleteMany({ where: { currency } }));
    const sample = (minute: string, provider: string, rate: string) => ({
      id: `rs_test_${minute}_${provider}`,
      token: "usdc",
      currency,
      provider,
      rate,
      rateBeforeFees: rate,
      feeMinor: 0n,
      receiveMinor: 1n,
      etaSeconds: 20,
      onTimePercent: 95,
      sampledAt: new Date(`2026-11-07T${minute}:00Z`),
    });
    await unit((tx) =>
      tx.rateSample.createMany({
        data: [
          sample("09:01", "paycrest", "1376"),
          sample("09:01", "busha", "1370"),
          sample("09:02", "paycrest", "1378"),
          sample("09:02", "busha", "1372"),
          sample("09:16", "paycrest", "1380"),
          sample("08:00", "paycrest", "1300"),
        ],
      }),
    );
    clock.at = new Date("2026-11-07T09:20:00Z");
    const reply = await get(`/v1/rates/usdc/${currency}/history?range=24h`);
    expect(reply.statusCode, reply.body).toBe(200);
    expect(reply.json()).toMatchObject({
      range: "24h",
      interval_seconds: 900,
      points: [
        { at: "2026-11-07T08:00:00.000Z", best: 1300, worst: 1300, p2p: null },
        { at: "2026-11-07T09:00:00.000Z", best: 1377, worst: 1371, p2p: null },
        { at: "2026-11-07T09:15:00.000Z", best: 1380, worst: 1380, p2p: null },
      ],
    });
    clock.at = new Date("2026-11-08T09:10:00Z");
    expect((await get(`/v1/rates/usdc/${currency}/history`)).json().points.map((p: { at: string }) => p.at)).toEqual(["2026-11-07T09:15:00.000Z"]);
    expect((await get(`/v1/rates/usdc/${currency}/history?range=1y`)).statusCode).toBe(400);
  });
});
