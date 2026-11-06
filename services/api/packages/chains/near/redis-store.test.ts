import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RedisRelayStore } from "./index";

// Runs against a real Redis when FLIQ_TEST_REDIS_URL is set (for example redis://127.0.0.1:6390).
const url = process.env.FLIQ_TEST_REDIS_URL;

describe.skipIf(!url)("RedisRelayStore against a real Redis", () => {
  const redis = new Redis(url ?? "redis://127.0.0.1:6379", { lazyConnect: true });
  let store: RedisRelayStore;

  beforeEach(() => {
    store = new RedisRelayStore(redis, `test:${randomUUID()}`);
  });

  afterAll(async () => {
    await redis.quit();
  });

  it("grants exactly the limit when many rate slots are taken at once", async () => {
    const now = Date.now();
    const taken = await Promise.all(
      Array.from({ length: 100 }, () => store.takeRateSlot("ada.testnet", 30, 3_600_000, now)),
    );
    expect(taken.filter(Boolean)).toHaveLength(30);
    expect(await store.takeRateSlot("bob.testnet", 30, 3_600_000, now)).toBe(true);
  });

  it("frees rate slots as the window slides", async () => {
    const start = Date.now();
    for (let i = 0; i < 3; i += 1) await store.takeRateSlot("ada.testnet", 3, 1_000, start);
    expect(await store.takeRateSlot("ada.testnet", 3, 1_000, start + 500)).toBe(false);
    expect(await store.takeRateSlot("ada.testnet", 3, 1_000, start + 1_001)).toBe(true);
  });

  it("leases each key to one holder at a time under heavy contention", async () => {
    const keys = ["k1", "k2", "k3", "k4", "k5"];
    const leases = await Promise.all(Array.from({ length: 50 }, () => store.lease(keys, 10_000)));
    const granted = leases.filter((lease) => lease !== null);
    expect(granted).toHaveLength(5);
    expect(new Set(granted.map((lease) => lease!.key)).size).toBe(5);
    expect(await store.lease(keys, 10_000)).toBeNull();
  });

  it("only lets the holder release a lease, and frees the key afterwards", async () => {
    const lease = (await store.lease(["k1"], 10_000))!;
    await store.release({ key: "k1", token: "someone-else" });
    expect(await store.lease(["k1"], 10_000)).toBeNull();
    await store.release(lease);
    expect(await store.lease(["k1"], 10_000)).not.toBeNull();
  });

  it("lets a lease expire so a crashed holder cannot block a key forever", async () => {
    await store.lease(["k1"], 50);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(await store.lease(["k1"], 10_000)).not.toBeNull();
  });

  it("hands out unique, increasing nonces to concurrent callers", async () => {
    const nonces = await Promise.all(
      Array.from({ length: 100 }, () => store.nextNonce("k1", 276_166_284_000_000n)),
    );
    const sorted = [...nonces].sort((a, b) => (a < b ? -1 : 1));
    expect(new Set(nonces).size).toBe(100);
    expect(sorted[0]).toBe(276_166_284_000_001n);
    expect(sorted[99]).toBe(276_166_284_000_100n);
  });

  it("jumps to the chain nonce when it is ahead, and counts beyond 2^53 exactly", async () => {
    expect(await store.nextNonce("k1", 5n)).toBe(6n);
    expect(await store.nextNonce("k1", 1_000n)).toBe(1_001n);
    expect(await store.nextNonce("k1", 3n)).toBe(1_002n);
    expect(await store.nextNonce("k2", 99_999_999_999_999_999_999n)).toBe(100_000_000_000_000_000_000n);
  });

  it("lets only one caller claim a delegate hash and shows the others its record", async () => {
    const claims = await Promise.all(Array.from({ length: 20 }, () => store.claim("h1", 60_000)));
    expect(claims.filter((claim) => claim === null)).toHaveLength(1);
    expect(claims.filter((claim) => claim?.state === "in_progress")).toHaveLength(19);
    const done = { state: "succeeded" as const, txHash: "tx", senderId: "a", receiverId: "b", failures: [] };
    await store.save("h1", done, 60_000);
    expect(await store.claim("h1", 60_000)).toEqual(done);
    await store.forget("h1");
    expect(await store.claim("h1", 60_000)).toBeNull();
  });
});
