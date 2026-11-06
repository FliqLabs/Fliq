import { describe, expect, it } from "vitest";
import { createNearRpc, NearRpcError, parseOutcome } from "./index";

// Shapes follow the NEAR JSON-RPC send_tx/query/block results. Modelled on responses seen from testnet, not captured.
const URL_WITH_KEY = "https://rpc.example.com/?apiKey=secret-in-url";

function rpcReturning(...bodies: unknown[]) {
  const sent: Record<string, unknown>[] = [];
  const fetchImpl = async (_: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    const body = bodies[Math.min(sent.length - 1, bodies.length - 1)];
    return body instanceof Response ? body : new Response(JSON.stringify(body));
  };
  return { rpc: createNearRpc({ url: URL_WITH_KEY, fetch: fetchImpl as typeof fetch }), sent };
}

const receipt = (status: unknown, gas = 10) => ({ id: "r", outcome: { status, gas_burnt: gas, logs: [] } });

const outcome = (receipts: unknown[], status: unknown = { SuccessValue: "" }) => ({
  status,
  transaction_outcome: { id: "TxHash111", outcome: { gas_burnt: 5, status: { SuccessReceiptId: "r" } } },
  receipts_outcome: receipts,
});

describe("parseOutcome", () => {
  it("reads a fully successful transaction", () => {
    expect(
      parseOutcome(outcome([receipt({ SuccessReceiptId: "x" }), receipt({ SuccessValue: "" })])),
    ).toEqual({
      txHash: "TxHash111",
      status: "succeeded",
      failures: [],
      gasBurnt: 25n,
    });
  });

  it("marks a meta transaction failed when the delegated call failed in its own receipt", () => {
    const failure = {
      ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: "insufficient balance" } } },
    };
    const result = parseOutcome(outcome([receipt({ SuccessReceiptId: "x" }), receipt({ Failure: failure })]));
    expect(result.status).toBe("failed");
    expect(result.failures[0]).toContain("insufficient balance");
  });

  it("rejects an outcome without a transaction hash", () => {
    expect(() => parseOutcome({ status: {}, transaction_outcome: { outcome: { gas_burnt: 1 } } })).toThrow(
      NearRpcError,
    );
  });
});

describe("createNearRpc", () => {
  it("sends the signed transaction and waits for FINAL", async () => {
    const { rpc, sent } = rpcReturning({ jsonrpc: "2.0", id: 1, result: outcome([]) });
    await rpc.sendTransaction("AAAA");
    expect(sent[0]).toMatchObject({
      method: "send_tx",
      params: { signed_tx_base64: "AAAA", wait_until: "FINAL" },
    });
  });

  it("returns null for an unknown account or key", async () => {
    const unknown = {
      jsonrpc: "2.0",
      id: 1,
      error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_ACCOUNT", info: {} } },
    };
    const { rpc } = rpcReturning(unknown);
    expect(await rpc.account("nobody.testnet")).toBeNull();
    expect(await rpc.accessKey("nobody.testnet", "ed25519:x")).toBeNull();
  });

  it("parses access keys of both kinds", async () => {
    const { rpc } = rpcReturning(
      { result: { nonce: 9, permission: "FullAccess", block_height: 1, block_hash: "h" } },
      {
        result: {
          nonce: 3,
          permission: {
            FunctionCall: { allowance: null, receiver_id: "v.testnet", method_names: ["payout"] },
          },
        },
      },
    );
    expect(await rpc.accessKey("a", "k")).toEqual({ nonce: 9n, permission: "FullAccess" });
    expect(await rpc.accessKey("a", "k")).toEqual({
      nonce: 3n,
      permission: { receiverId: "v.testnet", methodNames: ["payout"], allowance: null },
    });
  });

  it.each([
    ["an RPC timeout", { error: { cause: { name: "TIMEOUT_ERROR", info: {} } } }, "timeout", true],
    [
      "a refused transaction",
      { error: { cause: { name: "INVALID_TRANSACTION", info: { InvalidNonce: {} } } } },
      "invalid_transaction",
      false,
    ],
    ["an HTTP outage", new Response("", { status: 503 }), "unavailable", true],
    ["a body that is not JSON", new Response("<html>"), "invalid_response", false],
  ])("classifies %s", async (_, body, kind, unknown) => {
    const { rpc } = rpcReturning(body);
    const error = (await rpc.sendTransaction("AAAA").catch((e: unknown) => e)) as NearRpcError;
    expect(error).toBeInstanceOf(NearRpcError);
    expect(error).toMatchObject({ kind, outcomeUnknown: unknown });
    expect(error.message).not.toContain("secret-in-url");
  });
});
