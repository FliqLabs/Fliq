import { describe, expect, it } from "vitest";
import { httpsTransport } from "./transport.js";

const request = (url: string) => ({ url, headers: {}, body: "{}", timeoutMs: 1_000, deadlineMs: 5_000 });

describe("https webhook transport", () => {
  it("refuses plain http and private literals before opening a socket", async () => {
    const transport = httpsTransport(async () => ["93.184.215.14"]);
    expect(await transport(request("http://hooks.example.com/x"))).toEqual({ error: "blocked_destination" });
    expect(await transport(request("https://10.0.0.1/x"))).toEqual({ error: "blocked_destination" });
  });

  it("refuses a name that resolves to a private address at connect time", async () => {
    const transport = httpsTransport(async () => ["127.0.0.1"]);
    expect(await transport(request("https://hooks.example.com/x"))).toEqual({ error: "blocked_destination" });
  });

  it("ends the whole attempt at the deadline, even while the idle timeout has not fired", async () => {
    const transport = httpsTransport(() => new Promise<string[]>(() => {}));
    const started = Date.now();
    const outcome = await transport({ ...request("https://hooks.example.com/x"), timeoutMs: 60_000, deadlineMs: 50 });
    expect(outcome).toEqual({ error: "timeout" });
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
