import { createServer, type Server, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectRedis, withReconnect } from "../apps/api/src/redis.js";

// Answers the client's ready check, then goes silent: what a connection that died while the laptop slept looks like.
describe("a Redis connection that stops answering", () => {
  let server: Server;
  const sockets: Socket[] = [];
  let connections = 0;

  beforeAll(async () => {
    server = createServer((socket) => {
      connections += 1;
      sockets.push(socket);
      socket.on("data", (data) => {
        const text = data.toString().toLowerCase();
        for (const _ of text.match(/setinfo/g) ?? []) socket.write("+OK\r\n");
        if (text.includes("*1\r\n$4\r\ninfo\r\n")) socket.write("$0\r\n\r\n");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  afterAll(() => {
    for (const socket of sockets) socket.destroy();
    server.close();
  });

  it("gives up on a command within the timeout and opens a fresh connection", async () => {
    const redis = connectRedis(`redis://127.0.0.1:${(server.address() as AddressInfo).port}`);
    await new Promise<void>((resolve) => redis.once("ready", () => resolve()));
    const started = Date.now();
    await expect(withReconnect(redis, () => redis.ping())).rejects.toThrow("Command timed out");
    expect(Date.now() - started).toBeLessThan(5_000);
    await new Promise<void>((resolve) => redis.once("ready", () => resolve()));
    expect(connections).toBe(2);
    redis.disconnect();
  }, 15_000);
});
