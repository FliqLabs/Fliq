import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import type { KeyLease, RelayRecord, RelayStore } from "./store";

const NONCE_TTL_MS = 7 * 24 * 60 * 60_000;

// Each script runs atomically in Redis, so concurrent replicas cannot both take the last rate slot, the same key,
// or the same nonce.
const RATE_SLOT = `
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", tonumber(ARGV[2]) - tonumber(ARGV[3]))
if redis.call("ZCARD", KEYS[1]) >= tonumber(ARGV[1]) then return 0 end
redis.call("ZADD", KEYS[1], ARGV[2], ARGV[4])
redis.call("PEXPIRE", KEYS[1], ARGV[3])
return 1`;

const RELEASE = `
if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end
return 0`;

const NEXT_NONCE = `
local stored = redis.call("GET", KEYS[1])
local onchain = ARGV[1]
local base = onchain
if stored and (#stored > #onchain or (#stored == #onchain and stored > onchain)) then base = stored end
local digits = {}
for i = 1, #base do digits[i] = tonumber(string.sub(base, i, i)) end
local i = #digits
while i > 0 do
  if digits[i] < 9 then digits[i] = digits[i] + 1 break end
  digits[i] = 0
  i = i - 1
end
local next = table.concat(digits)
if i == 0 then next = "1" .. next end
redis.call("SET", KEYS[1], next, "PX", ARGV[2])
return next`;

export class RedisRelayStore implements RelayStore {
  readonly #redis: Redis;
  readonly #prefix: string;

  constructor(redis: Redis, prefix = "relayer") {
    this.#redis = redis;
    this.#prefix = prefix;
  }

  async takeRateSlot(sender: string, limit: number, windowMs: number, nowMs: number): Promise<boolean> {
    const key = `${this.#prefix}:rate:${sender}`;
    const taken = await this.#redis.eval(
      RATE_SLOT,
      1,
      key,
      limit,
      nowMs,
      windowMs,
      `${nowMs}:${randomUUID()}`,
    );
    return taken === 1;
  }

  async claim(hash: string, ttlMs: number): Promise<RelayRecord | null> {
    const key = `${this.#prefix}:delegate:${hash}`;
    const set = await this.#redis.set(key, JSON.stringify({ state: "in_progress" }), "PX", ttlMs, "NX");
    return set === "OK" ? null : ((await this.read(hash)) ?? { state: "in_progress" });
  }

  async save(hash: string, record: RelayRecord, ttlMs: number): Promise<void> {
    await this.#redis.set(`${this.#prefix}:delegate:${hash}`, JSON.stringify(record), "PX", ttlMs);
  }

  async forget(hash: string): Promise<void> {
    await this.#redis.del(`${this.#prefix}:delegate:${hash}`);
  }

  async read(hash: string): Promise<RelayRecord | null> {
    const raw = await this.#redis.get(`${this.#prefix}:delegate:${hash}`);
    return raw ? (JSON.parse(raw) as RelayRecord) : null;
  }

  async lease(keys: readonly string[], ttlMs: number): Promise<KeyLease | null> {
    const token = randomUUID();
    const start = Math.floor(Math.random() * keys.length);
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[(start + i) % keys.length] as string;
      const set = await this.#redis.set(`${this.#prefix}:lease:${key}`, token, "PX", ttlMs, "NX");
      if (set === "OK") return { key, token };
    }
    return null;
  }

  async release(lease: KeyLease): Promise<void> {
    await this.#redis.eval(RELEASE, 1, `${this.#prefix}:lease:${lease.key}`, lease.token);
  }

  // Nonces exceed 2^53, so the script compares and increments them as decimal strings.
  async nextNonce(key: string, onChain: bigint): Promise<bigint> {
    const next = await this.#redis.eval(
      NEXT_NONCE,
      1,
      `${this.#prefix}:nonce:${key}`,
      onChain.toString(),
      NONCE_TTL_MS,
    );
    return BigInt(String(next));
  }
}
