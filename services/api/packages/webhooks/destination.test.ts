import { describe, expect, it } from "vitest";
import {
  BlockedDestination,
  checkDestination,
  guardedLookup,
  isPublicAddress,
  parseWebhookUrl,
} from "./destination.js";

const resolveTo =
  (...addresses: string[]) =>
  async () =>
    addresses;

describe("webhook destinations", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.9",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "::ffff:10.0.0.1",
    "::ffff:127.0.0.1",
    "64:ff9b::a00:1",
    "2002:a00:1::1",
    "2002:7f00:1::",
    "2001:0:4136:e378:8000:63bf:3fff:fdd2",
    "2001::1",
  ])("refuses %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["93.184.215.14", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888"])("accepts %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    "http://example.com/hook",
    "ftp://example.com/hook",
    "https://user:pass@example.com/hook",
    "https://example.com/hook#frag",
    "https://localhost/hook",
    "https://app.localhost/hook",
    "https://api.railway.internal/hook",
    "https://printer.local/hook",
    "https://intranet/hook",
    "https://127.0.0.1/hook",
    "https://[::1]/hook",
    "https://169.254.169.254/latest/meta-data",
    "not a url",
    `https://example.com/${"a".repeat(2050)}`,
  ])("refuses the URL %s", (url) => {
    expect(() => parseWebhookUrl(url)).toThrow(BlockedDestination);
  });

  it("accepts a public https URL with a port, path and query", () => {
    expect(parseWebhookUrl("https://hooks.example.com:8443/fliq?team=1").host).toBe("hooks.example.com:8443");
  });

  it("refuses a name that resolves to any private address, or does not resolve", async () => {
    await expect(
      checkDestination("https://hooks.example.com/x", resolveTo("93.184.215.14", "10.0.0.5")),
    ).rejects.toThrow(BlockedDestination);
    await expect(checkDestination("https://hooks.example.com/x", resolveTo())).rejects.toThrow(
      BlockedDestination,
    );
    await expect(
      checkDestination("https://hooks.example.com/x", async () => {
        throw new Error("ENOTFOUND");
      }),
    ).rejects.toThrow(/does not resolve/);
    await expect(
      checkDestination("https://hooks.example.com/x", resolveTo("93.184.215.14")),
    ).resolves.toBeInstanceOf(URL);
  });

  it("re-checks at connect time, so a name rebound to a private address is refused", async () => {
    const lookup = guardedLookup(resolveTo("127.0.0.1"));
    const error = await new Promise<Error | null>((done) =>
      lookup("hooks.example.com", {}, (failure) => done(failure)),
    );
    expect(error).toBeInstanceOf(BlockedDestination);

    const ok = guardedLookup(resolveTo("93.184.215.14"));
    const address = await new Promise<string>((done) =>
      ok("hooks.example.com", {}, (_e, value) => done(value as string)),
    );
    expect(address).toBe("93.184.215.14");
  });
});
