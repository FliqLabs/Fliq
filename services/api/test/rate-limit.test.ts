import { randomBytes } from "node:crypto";
import { Redis } from "ioredis";
import { describe, expect, it } from "vitest";
import { buildApp } from "../apps/api/src/app.js";
import { signAccessToken } from "../apps/api/src/auth/tokens.js";
import type { Config } from "../apps/api/src/config.js";
import { MemoryLimiter, RedisLimiter, type Policy } from "../apps/api/src/rate-limit.js";

const config = { accessSecret: "test-secret" } as Config;
const idle = async () => {
  throw new Error("database must not be used");
};
const ok = async () => ({ status: 200, body: { status: "ok" } });

function appWith(limiter = new MemoryLimiter()) {
  return buildApp({ config, unit: idle as never, limiter, handlers: { getHealth: ok, startPasskeyLogin: ok } });
}

describe("token bucket", () => {
  const policy: Policy = { name: "t", capacity: 3, refillPerSecond: 1 };

  it("allows the burst, then refuses, then refills over time", async () => {
    let now = 0;
    const limiter = new MemoryLimiter(() => now);
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await limiter.take("k", policy));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3]).toMatchObject({ remaining: 0, resetSeconds: 1 });
    now += 2_000;
    expect((await limiter.take("k", policy)).allowed).toBe(true);
  });

  it("keeps keys separate", async () => {
    const limiter = new MemoryLimiter(() => 0);
    for (let i = 0; i < 3; i++) await limiter.take("a", policy);
    expect((await limiter.take("a", policy)).allowed).toBe(false);
    expect((await limiter.take("b", policy)).allowed).toBe(true);
  });
});

describe("request pipeline", () => {
  it("sends standard headers and answers 429 in the shared error shape", async () => {
    const app = appWith();
    const first = await app.inject({ method: "GET", url: "/v1/health" });
    expect(first.headers["ratelimit-limit"]).toBe("60");
    expect(first.headers["ratelimit-remaining"]).toBe("59");

    for (let i = 0; i < 59; i++) await app.inject({ method: "GET", url: "/v1/health" });
    const refused = await app.inject({ method: "GET", url: "/v1/health" });
    expect(refused.statusCode).toBe(429);
    expect(refused.json().error.code).toBe("rate_limited");
    expect(Number(refused.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(refused.headers["ratelimit-remaining"]).toBe("0");
    expect(refused.headers["x-trace-id"]).toBeTruthy();
  });

  it("gives sign-in endpoints a smaller bucket than other routes", async () => {
    const app = appWith();
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await app.inject({ method: "POST", url: "/v1/auth/passkeys/login/options" })).statusCode);
    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect((await app.inject({ method: "GET", url: "/v1/health" })).statusCode).toBe(200);
  });

  it("limits signed-in users per user, not per address", async () => {
    const app = appWith();
    for (let i = 0; i < 60; i++) await app.inject({ method: "GET", url: "/v1/health" });
    expect((await app.inject({ method: "GET", url: "/v1/health" })).statusCode).toBe(429);

    const token = signAccessToken("usr_1", "ses_1", config.accessSecret, Math.floor(Date.now() / 1000));
    const signedIn = await app.inject({ method: "GET", url: "/v1/health", headers: { authorization: `Bearer ${token}` } });
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.headers["ratelimit-limit"]).toBe("300");
  });

  it("fails open when the limiter is down", async () => {
    const broken = { take: async () => Promise.reject(new Error("redis down")) };
    const app = buildApp({ config, unit: idle as never, limiter: broken, handlers: { getHealth: ok } });
    expect((await app.inject({ method: "GET", url: "/v1/health" })).statusCode).toBe(200);
  });
});

describe.skipIf(!process.env.REDIS_URL)("redis limiter", () => {
  it("shares one bucket across calls and refuses past capacity", async () => {
    const redis = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: 1 });
    const limiter = new RedisLimiter(redis);
    const policy: Policy = { name: `test-${randomBytes(4).toString("hex")}`, capacity: 2, refillPerSecond: 0.01 };
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await limiter.take("k", policy));
    expect(results.map((r) => r.allowed)).toEqual([true, true, false]);
    expect(results[0]).toMatchObject({ limit: 2, remaining: 1 });
    redis.disconnect();
  }, 60_000);
});
