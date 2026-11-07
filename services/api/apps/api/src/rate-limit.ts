import type { FastifyReply, FastifyRequest } from "fastify";
import { Redis } from "ioredis";
import { sha256Hex } from "../../../packages/db/src/crypto.js";
import { verifyAccessToken } from "./auth/tokens.js";
import { ApiError } from "./errors.js";

export interface Policy {
  name: string;
  capacity: number;
  refillPerSecond: number;
}

export interface Decision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

export interface Limiter {
  take(key: string, policy: Policy): Promise<Decision>;
}

const perMinute = (name: string, capacity: number): Policy => ({ name, capacity, refillPerSecond: capacity / 60 });

// Sign-in endpoints are the brute-force target, so they get the smallest bucket and are always keyed by IP.
export const POLICIES = {
  auth: perMinute("auth", 10),
  anonymous: perMinute("anonymous", 60),
  signedIn: perMinute("signed_in", 300),
  apiKey: perMinute("api_key", 300),
};

function decide(tokens: number, policy: Policy): Decision {
  const allowed = tokens >= 1;
  const left = allowed ? tokens - 1 : tokens;
  const missing = allowed ? policy.capacity - left : 1 - left;
  return {
    allowed,
    limit: policy.capacity,
    remaining: Math.floor(left),
    resetSeconds: Math.max(1, Math.ceil(missing / policy.refillPerSecond)),
  };
}

export class MemoryLimiter implements Limiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async take(key: string, policy: Policy): Promise<Decision> {
    const now = this.now();
    const id = `${policy.name}:${key}`;
    const bucket = this.buckets.get(id) ?? { tokens: policy.capacity, at: now };
    const refilled = Math.min(policy.capacity, bucket.tokens + ((now - bucket.at) / 1000) * policy.refillPerSecond);
    const decision = decide(refilled, policy);
    this.buckets.set(id, { tokens: decision.allowed ? refilled - 1 : refilled, at: now });
    return decision;
  }
}

// Atomic token bucket. The clock comes from Redis so several API instances cannot disagree about time.
const TAKE_SCRIPT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local state = redis.call('HMGET', KEYS[1], 'tokens', 'at')
local tokens = tonumber(state[1]) or capacity
local at = tonumber(state[2]) or now
tokens = math.min(capacity, tokens + (now - at) / 1000 * rate)
if tokens >= 1 then redis.call('HSET', KEYS[1], 'tokens', tokens - 1, 'at', now) else redis.call('HSET', KEYS[1], 'tokens', tokens, 'at', now) end
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / rate * 2000))
return tostring(tokens)
`;

export class RedisLimiter implements Limiter {
  constructor(private readonly redis: Redis) {}

  async take(key: string, policy: Policy): Promise<Decision> {
    const tokens = await this.redis.eval(TAKE_SCRIPT, 1, `rl:${policy.name}:${key}`, policy.capacity, policy.refillPerSecond);
    return decide(Number(tokens), policy);
  }
}

export function createLimiter(redisUrl: string | undefined): Limiter {
  if (!redisUrl) {
    console.warn("REDIS_URL is not set: rate limits are kept in this process only.");
    return new MemoryLimiter();
  }
  return new RedisLimiter(new Redis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false }));
}

interface Identity {
  policy: Policy;
  key: string;
}

const PROVEN_KEY_LIMIT = 10_000;
const PROVEN_KEY_TTL_MS = 10 * 60_000;

// API keys that passed authentication recently, by hash. Only these get their own bucket: an unproven
// "rt_" token stays in the caller's IP bucket, so sending a fresh random key on each request cannot dodge
// the anonymous limit or buy a database lookup per request. Kept per process and bounded, so a valid key
// spends one IP token on each instance before it moves to its own bucket. A key revoked while proven
// keeps its bucket until the entry expires, and is still refused by authentication.
export class ProvenKeys {
  private readonly seen = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  add(token: string): void {
    const hash = keyHash(token);
    this.seen.delete(hash);
    this.seen.set(hash, this.now() + PROVEN_KEY_TTL_MS);
    if (this.seen.size > PROVEN_KEY_LIMIT) this.seen.delete(this.seen.keys().next().value as string);
  }

  has(token: string): boolean {
    const hash = keyHash(token);
    const until = this.seen.get(hash);
    if (until === undefined) return false;
    if (until > this.now()) return true;
    this.seen.delete(hash);
    return false;
  }
}

// Keyed by the key's hash, never the key itself, because bucket names are visible to anyone reading Redis.
const keyHash = (token: string) => sha256Hex(token).slice(0, 32);

function identify(request: FastifyRequest, accessSecret: string, provenKeys: ProvenKeys): Identity {
  const anonymous = { policy: POLICIES.anonymous, key: `ip:${request.ip}` };
  if (request.url.startsWith("/v1/auth/")) return { policy: POLICIES.auth, key: `ip:${request.ip}` };
  const token = request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7) : null;
  if (token?.startsWith("rt_")) {
    return provenKeys.has(token) ? { policy: POLICIES.apiKey, key: `key:${keyHash(token)}` } : anonymous;
  }
  const claims = token ? verifyAccessToken(token, accessSecret, Math.floor(Date.now() / 1000)) : null;
  return claims ? { policy: POLICIES.signedIn, key: `user:${claims.sub}` } : anonymous;
}

function setHeaders(reply: FastifyReply, decision: Decision) {
  reply.header("RateLimit-Limit", decision.limit);
  reply.header("RateLimit-Remaining", decision.remaining);
  reply.header("RateLimit-Reset", decision.resetSeconds);
}

// A broken limiter must not take the API down, so it fails open and logs.
export function rateLimitHook(limiter: Limiter, accessSecret: string, provenKeys: ProvenKeys) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { policy, key } = identify(request, accessSecret, provenKeys);
    const decision = await limiter.take(key, policy).catch((error: Error) => {
      request.log.error({ err: { message: error.message } }, "rate limiter unavailable");
      return null;
    });
    if (!decision) return;
    setHeaders(reply, decision);
    if (decision.allowed) return;
    reply.header("Retry-After", decision.resetSeconds);
    throw new ApiError(429, "rate_limited", "Too many requests. Try again later.");
  };
}
