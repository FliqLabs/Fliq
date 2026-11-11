import { describe, expect, it } from "vitest";
import { newUser } from "../../packages/chains/near/near.fixtures.js";
import { contextFrom, readConfig } from "../src/config.js";

const AGENT = "claude-frank.fliq.near";
const KEY = newUser(AGENT).key.toString();
const noFile = (path: string): string => {
  throw new Error(`no file at ${path}`);
};

describe("startup mode", () => {
  it("runs in developer mode with an API key, from base unless FLIQ_SOURCE_CHAIN says otherwise", () => {
    expect(readConfig({ FLIQ_API_KEY: "rt_test_x" }).mode).toEqual({
      kind: "developer",
      apiKey: "rt_test_x",
      sourceChain: "base",
      refundAddress: undefined,
    });
    expect(readConfig({ FLIQ_API_KEY: "rt_test_x", FLIQ_SOURCE_CHAIN: "solana" }).mode).toMatchObject({
      sourceChain: "solana",
    });
    expect(() => readConfig({ FLIQ_API_KEY: "rt_test_x", FLIQ_SOURCE_CHAIN: "near" })).toThrow(
      "FLIQ_SOURCE_CHAIN must be one of base, polygon, solana.",
    );
  });

  it("refuses to start with neither an API key nor an agent", () => {
    expect(() => readConfig({})).toThrow("Set FLIQ_API_KEY");
    expect(() => readConfig({})).toThrow("FLIQ_AGENT_ID and FLIQ_AGENT_KEY_FILE");
  });

  it("runs in agent mode from a key file, ahead of any API key, with a NEAR RPC picked by network", () => {
    const config = readConfig(
      { FLIQ_API_KEY: "rt_test_x", FLIQ_AGENT_ID: AGENT, FLIQ_AGENT_KEY_FILE: "/keys/claude.key" },
      (path) => (path === "/keys/claude.key" ? `${KEY}\n` : noFile(path)),
    );
    expect(config.mode).toEqual({
      kind: "agent",
      agentId: AGENT,
      secretKey: KEY,
      nearRpcUrl: "https://rpc.mainnet.fastnear.com",
    });
    const testnet = readConfig({ FLIQ_AGENT_ID: "claude-ada.fliq.testnet", FLIQ_AGENT_PRIVATE_KEY: KEY });
    expect(testnet.mode).toMatchObject({ nearRpcUrl: "https://rpc.testnet.fastnear.com" });
  });

  it("names what a half-configured agent is missing", () => {
    expect(() => readConfig({ FLIQ_AGENT_ID: AGENT })).toThrow(
      "Agent mode also needs FLIQ_AGENT_KEY_FILE or FLIQ_AGENT_PRIVATE_KEY.",
    );
    expect(() => readConfig({ FLIQ_AGENT_PRIVATE_KEY: KEY })).toThrow("Agent mode also needs FLIQ_AGENT_ID");
    expect(() =>
      readConfig({ FLIQ_AGENT_ID: AGENT, FLIQ_AGENT_PRIVATE_KEY: KEY, FLIQ_AGENT_KEY_FILE: "/k" }, noFile),
    ).toThrow("not both");
    expect(() => readConfig({ FLIQ_AGENT_ID: AGENT, FLIQ_AGENT_KEY_FILE: "/missing.key" }, noFile)).toThrow(
      "FLIQ_AGENT_KEY_FILE could not be read: /missing.key.",
    );
  });

  it("stops at start on an agent key that is not an ed25519 secret", async () => {
    const config = readConfig({ FLIQ_AGENT_ID: AGENT, FLIQ_AGENT_PRIVATE_KEY: "ed25519:abc" });
    await expect(contextFrom(config)).rejects.toThrow("64 bytes");
  });

  it("refuses a receipt template without {payout_id}", () => {
    expect(() => readConfig({ FLIQ_API_KEY: "rt_test_x", FLIQ_RECEIPT_URL: "https://r.example" })).toThrow(
      "{payout_id}",
    );
  });
});
