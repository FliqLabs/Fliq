import { describe, expect, it } from "vitest";
import { addressTopic, createEvmRpc, RpcError, TRANSFER_TOPIC } from "./index";

const URL_WITH_KEY = "https://base-mainnet.example.com/v2/secret-key-in-path";
const DEPOSIT = "0x76B4c56085ED136a8744D52bE956396624A730E8";

function rpcReturning(...results: unknown[]) {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = async (_: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const next = results[Math.min(bodies.length - 1, results.length - 1)];
    return next instanceof Response
      ? next
      : new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, ...(next as object) }));
  };
  return { rpc: createEvmRpc({ url: URL_WITH_KEY, fetch: fetchImpl as typeof fetch }), bodies };
}

const log = {
  address: "0x833589FCD6EDB6E08F4C7C32D4F71B54BDA02913",
  topics: [TRANSFER_TOPIC, addressTopic("0x5e0de"), addressTopic(DEPOSIT)],
  data: `0x${50_000_000n.toString(16).padStart(64, "0")}`,
  blockNumber: "0x65",
  blockHash: "0xb10c4a5e",
  transactionHash: "0x7a11",
  logIndex: "0x3",
  removed: false,
};

describe("createEvmRpc", () => {
  it("asks for Transfer logs to the watched recipients, padded into the third topic", async () => {
    const { rpc, bodies } = rpcReturning({ result: [log] });
    const logs = await rpc.transferLogs({
      fromBlock: 99n,
      toBlock: 108n,
      tokens: ["0xusdc"],
      recipients: [DEPOSIT],
    });
    expect(bodies[0]).toMatchObject({
      method: "eth_getLogs",
      params: [
        {
          fromBlock: "0x63",
          toBlock: "0x6c",
          address: ["0xusdc"],
          topics: [TRANSFER_TOPIC, null, [`0x000000000000000000000000${DEPOSIT.slice(2).toLowerCase()}`]],
        },
      ],
    });
    expect(logs).toEqual([
      {
        token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        from: `0x${"5e0de".padStart(40, "0")}`,
        to: DEPOSIT.toLowerCase(),
        amount: 50_000_000n,
        txHash: "0x7a11",
        logIndex: 3,
        blockNumber: 101n,
        blockHash: "0xb10c4a5e",
        removed: false,
      },
    ]);
  });

  it("reads block numbers, hashes and times", async () => {
    const { rpc } = rpcReturning(
      { result: "0x64" },
      { result: { number: "0x64", hash: "0xab", timestamp: "0x6729a0c0" } },
    );
    expect(await rpc.blockNumber()).toBe(100n);
    expect(await rpc.block(100n)).toEqual({
      number: 100n,
      hash: "0xab",
      timestamp: new Date(0x6729a0c0 * 1000),
    });
  });

  it.each([
    ["an HTTP outage", new Response("", { status: 503 }), "unavailable"],
    [
      "a JSON-RPC error such as a range limit",
      { error: { code: -32005, message: "query exceeds limit" } },
      "rpc_error",
    ],
    ["a log that is not a Transfer", { result: [{ ...log, topics: [TRANSFER_TOPIC] }] }, "invalid_response"],
    ["a Transfer with no amount", { result: [{ ...log, data: "0x" }] }, "invalid_response"],
  ])("reports %s as a typed error without the URL", async (_, reply, kind) => {
    const { rpc } = rpcReturning(reply);
    const error = await rpc
      .transferLogs({ fromBlock: 1n, toBlock: 2n, tokens: [], recipients: [] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect(error).toMatchObject({ kind });
    expect((error as Error).message).not.toContain("secret-key-in-path");
  });
});
