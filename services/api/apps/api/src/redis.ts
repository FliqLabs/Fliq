import { Redis } from "ioredis";

const TIMED_OUT = "Command timed out";

// A socket that died while the machine slept or the network dropped is otherwise only noticed when the OS gives up
// on it, about 16 minutes later; until then every command hangs. Keepalive finds it sooner, and a command that times
// out drops the connection so the next one starts fresh.
export function connectRedis(url: string): Redis {
  const redis = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 10_000,
    keepAlive: 30_000,
    commandTimeout: 4_000,
  });
  redis.on("error", (error: Error) => console.warn("[redis]", error.name));
  return redis;
}

export async function withReconnect<T>(redis: Redis, command: () => Promise<T>): Promise<T> {
  try {
    return await command();
  } catch (error) {
    if ((error as Error).message === TIMED_OUT) redis.disconnect(true);
    throw error;
  }
}
