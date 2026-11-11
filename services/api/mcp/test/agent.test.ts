import { describe, expect, it } from "vitest";
import { authenticateAgent } from "../../apps/api/src/agent-auth.js";
import type { Db } from "../../apps/api/src/db.js";
import { verifySignedDelegate } from "../../packages/chains/near/delegate.js";
import { newUser } from "../../packages/chains/near/near.fixtures.js";
import type { AgentPayout, Payout } from "../../sdk/src/index.js";
import { fixture, type Recorded } from "../../sdk/test/fake-api.js";
import { instructionsFor, toolsFor } from "../src/tools/definitions.js";
import { startFromEnv, type Routes } from "./harness.js";

const AGENT = "claude-frank.fliq.near";
const user = newUser(AGENT);
const agentPayout = fixture<AgentPayout>("agent.payout.json");
const settled = fixture<Payout>("payout.settled.json");
const relayFailed = fixture("relay.failed.json");

const rpc = { status: 200, body: { result: { nonce: 41, block_height: 5_000 } } };
const relayed = {
  status: 200,
  body: { ...relayFailed, sender_id: AGENT, status: "succeeded", failures: [] },
};

function start(routes: Routes) {
  return startFromEnv(
    { "POST /": rpc, ...routes },
    {
      FLIQ_AGENT_ID: AGENT,
      FLIQ_AGENT_PRIVATE_KEY: user.key.toString(),
      FLIQ_NEAR_RPC_URL: "http://rpc.test/",
    },
  );
}

// The API's own check, against an agent table holding only this agent's public key.
async function expectSignedByAgent(request: Recorded) {
  const tx = {
    agent: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === AGENT ? { id: AGENT, publicKey: user.publicKey, state: "active" } : null,
    },
  } as unknown as Db;
  const headers = {
    agent: request.headers["x-fliq-agent"],
    timestamp: request.headers["x-fliq-timestamp"],
    signature: request.headers["x-fliq-signature"],
  };
  const now = Math.floor(Date.now() / 1000);
  await expect(
    authenticateAgent(tx, headers, request.method, request.pathWithQuery, request.rawBody, now),
  ).resolves.toMatchObject({ id: AGENT });
}

const agentRequests = (requests: Recorded[]) =>
  requests.filter((request) => request.path.startsWith("/agent"));

describe("stdio MCP server in agent mode", () => {
  it("lists the agent tools and the agent instructions", async () => {
    const server = await start({});
    const init = await server.request("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
    expect(init.result).toMatchObject({ instructions: instructionsFor("agent") });
    const list = (await server.request("tools/list")).result as { tools: { name: string }[] };
    expect(list.tools.map((tool) => tool.name)).toEqual([
      "cashout_limits",
      "cashout_recipients",
      "cashout_quote",
      "cashout_pay",
      "cashout_status",
    ]);
    expect(list.tools).toEqual(toolsFor("agent"));
    expect(
      (await server.request("tools/call", { name: "cashout_verify_account", arguments: {} })).error,
    ).toMatchObject({
      code: -32602,
    });
    await server.stop();
  });

  it("reads limits, lists saved accounts, quotes, pays from the vault and tracks the payout, every request signed", async () => {
    const server = await start({
      "GET /agent": { status: 200, body: fixture("agent.self.json") },
      "GET /agent/recipients": { status: 200, body: fixture("recipients.list.json") },
      "POST /agent/quotes": { status: 200, body: fixture("quote.usdc-ngn-50.json") },
      "POST /agent/payouts": { status: 201, body: agentPayout },
      "POST /agent/relays": relayed,
      "GET /agent/payouts/po_9c2f71aa": { status: 200, body: settled },
    });

    const limits = await server.call("cashout_limits");
    expect(limits.envelope.summary).toBe(
      "Claude may pay up to 50000 NGN per payout and 150000 NGN a day in NGN; 87.19 USDC is left today. Only the owner's saved accounts can be paid.",
    );
    const saved = await server.call("cashout_recipients");
    expect(saved.envelope).toMatchObject({
      summary: "1 saved account: DARA OKONKWO (GTBank ending 6789).",
      data: { recipients: [{ recipient_id: "rcp_5d1c0a9e", account_last4: "6789" }] },
    });
    const quoted = await server.call("cashout_quote", { amount: "50.00", currency: "ngn" });
    expect(quoted.envelope).toMatchObject({ status: "ok", data: { quote_id: "q_31ad77e0" } });

    const paid = await server.call("cashout_pay", { quote_id: "q_31ad77e0", recipient_id: "rcp_5d1c0a9e" });
    expect(paid.isError).toBe(false);
    expect(paid.envelope).toMatchObject({
      status: "pending",
      provider_of_record: "paycrest",
      refund_address: "vault",
      receipt_link: "https://receipts.example/po_9c2f71aa",
      data: { payout_id: "po_9c2f71aa", relay: { status: "succeeded" } },
    });
    const status = await server.call("cashout_status", { payout_id: "po_9c2f71aa" });
    expect(status.envelope.data).toMatchObject({ state: "settled" });
    await server.stop();

    const requests = agentRequests(server.api.requests);
    expect(requests.map((request) => `${request.method} ${request.pathWithQuery}`)).toEqual([
      "GET /v1/agent",
      "GET /v1/agent/recipients",
      "POST /v1/agent/quotes",
      "POST /v1/agent/payouts",
      "POST /v1/agent/relays",
      "GET /v1/agent/payouts/po_9c2f71aa",
    ]);
    for (const request of requests) {
      expect(request.headers.authorization).toBeUndefined();
      await expectSignedByAgent(request);
    }
    expect(requests[2]?.body).toEqual({ amount: "50.00", currency: "ngn" });
    expect(requests[3]?.headers["idempotency-key"]).toBe("fliq-mcp-q_31ad77e0");
    expect(requests[3]?.body).toEqual({ quote_id: "q_31ad77e0", recipient_id: "rcp_5d1c0a9e" });

    const delegate = verifySignedDelegate((requests[4]?.body as { signed_delegate: string }).signed_delegate);
    expect(delegate).toMatchObject({
      senderId: AGENT,
      receiverId: agentPayout.sign.receiver_id,
      nonce: 42n,
      maxBlockHeight: 5_120n,
      publicKey: user.publicKey,
    });
    expect(delegate.calls).toHaveLength(1);
    expect(delegate.calls[0]).toMatchObject({ methodName: "payout", gas: 80_000_000_000_000n, deposit: 0n });
    expect(JSON.parse(new TextDecoder().decode(delegate.calls[0]?.args))).toEqual(agentPayout.sign.args);
  });

  it("reports a payout over the agent's limits as refused and signs nothing", async () => {
    const server = await start({
      "POST /agent/payouts": {
        status: 422,
        body: { error: { code: "agent_limit", message: "Over this agent's daily cap." } },
      },
    });
    const { envelope, isError } = await server.call("cashout_pay", {
      quote_id: "q_31ad77e0",
      recipient_id: "rcp_5d1c0a9e",
    });
    expect(isError).toBe(true);
    expect(envelope).toMatchObject({ status: "refused", data: { code: "agent_limit" } });
    expect(envelope.summary).toBe(
      "fliq refused the payout: Over this agent's daily cap. Nothing moved. The owner can change the limits in the fliq app.",
    );
    expect(server.api.requests.some((request) => request.path === "/agent/relays")).toBe(false);
    await server.stop();
  });

  it("reports a cap refusal from the vault on chain as refused", async () => {
    const server = await start({
      "POST /agent/payouts": { status: 201, body: agentPayout },
      "POST /agent/relays": {
        status: 200,
        body: {
          ...relayFailed,
          failures: [
            '{"ActionError":{"index":0,"kind":{"FunctionCallError":{"ExecutionError":"Smart contract panicked: fliq_vault: POLICY_DAILY_CAP"}}}}',
          ],
        },
      },
    });
    const { envelope, isError } = await server.call("cashout_pay", {
      quote_id: "q_31ad77e0",
      recipient_id: "rcp_5d1c0a9e",
    });
    expect(isError).toBe(true);
    expect(envelope.status).toBe("refused");
    expect(envelope.summary).toContain("POLICY_DAILY_CAP");
    await server.stop();
  });

  it("names the reserved payout when the relay is not accepted", async () => {
    const server = await start({
      "POST /agent/payouts": { status: 201, body: agentPayout },
      "POST /agent/relays": {
        status: 503,
        body: { error: { code: "chain_unavailable", message: "The relayer is not reachable." } },
      },
    });
    const { envelope, isError } = await server.call("cashout_pay", {
      quote_id: "q_31ad77e0",
      recipient_id: "rcp_5d1c0a9e",
    });
    expect(isError).toBe(true);
    expect(envelope).toMatchObject({ status: "error", data: { payout_id: "po_9c2f71aa" } });
    expect(envelope.summary).toContain("Nothing has moved");
    await server.stop();
  });
});
