import { describe, expect, it } from "vitest";
import { createRelayerClient, RelayerClientError } from "./index";

function clientReturning(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  };
  const client = createRelayerClient({
    url: "http://relayer.railway.internal:4200/",
    authToken: "relayer-token-value",
    fetch: fetchImpl as unknown as typeof fetch,
  });
  return { client, calls };
}

describe("createRelayerClient", () => {
  it("posts the signed delegate with the bearer token", async () => {
    const { client, calls } = clientReturning(200, { status: "succeeded", tx_hash: "h" });
    expect(await client.relay("AAAA")).toMatchObject({ status: "succeeded" });
    expect(calls[0]!.url).toBe("http://relayer.railway.internal:4200/v1/relays");
    expect(new Headers(calls[0]!.init.headers).get("authorization")).toBe("Bearer relayer-token-value");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ signed_delegate: "AAAA" });
  });

  it("asks the relayer to create or link an account", async () => {
    const { client, calls } = clientReturning(201, { status: "created", account_id: "ada.fliq.testnet" });
    expect((await client.provisionAccount("ada.fliq.testnet", "ed25519:abc")).status).toBe("created");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      account_id: "ada.fliq.testnet",
      public_key: "ed25519:abc",
    });
  });

  it("turns relayer errors into typed errors with the relayer's code", async () => {
    const { client } = clientReturning(429, { error: { code: "rate_limited", message: "slow down" } });
    const error = (await client.relay("AAAA").catch((e: unknown) => e)) as RelayerClientError;
    expect(error).toBeInstanceOf(RelayerClientError);
    expect(error).toMatchObject({ status: 429, code: "rate_limited", message: "slow down" });
  });

  it("reports an unreachable relayer without leaking the token", async () => {
    const client = createRelayerClient({
      url: "http://relayer.railway.internal:4200",
      authToken: "relayer-token-value",
      fetch: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    const error = (await client.relayStatus("ab").catch((e: unknown) => e)) as RelayerClientError;
    expect(error).toMatchObject({ status: 0, code: "relayer_unreachable" });
    expect(error.message).not.toContain("relayer-token-value");
  });
});
