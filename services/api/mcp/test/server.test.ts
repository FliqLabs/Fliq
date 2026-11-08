import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { newUser, VAULT } from "../../packages/chains/near/near.fixtures.js";
import { FliqClient, type Payout } from "../../sdk/src/index.js";
import { API_KEY, BASE_URL, fakeApi, fixture } from "../../sdk/test/fake-api.js";
import { createVaultAgent, type VaultAgent } from "../src/agent/vault-agent.js";
import { receiptLinker } from "../src/config.js";
import { PROTOCOL_VERSIONS, serve, type Log } from "../src/server.js";
import { TOOL_DEFINITIONS } from "../src/tools/definitions.js";
import type { Envelope } from "../src/tools/envelope.js";
import { Session } from "../src/tools/session.js";

const quote = fixture("quote.usdc-ngn-50.json");
const verified = fixture("verify.gtbank-0123456789.json");
const created = fixture<Payout>("payout.created.json");
const settled = fixture<Payout>("payout.settled.json");
// What the API returns for a payout funded from the vault: vault_receipt is the payout id, the vault order id.
const vaultOrder: Payout = { ...created, vault_receipt: created.payout_id };
const relayFailed = fixture("relay.failed.json");

const recipient = { country: "ng", bank: "058", number: "0123456789" };
const RECEIPTS = "https://receipts.example/{payout_id}";

type Routes = Parameters<typeof fakeApi>[0];

function start(routes: Routes, agent?: VaultAgent) {
  const api = fakeApi(routes);
  const client = new FliqClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch: api.fetch });
  const input = new PassThrough();
  const output = new PassThrough();
  const logs: string[] = [];
  const log: Log = (event, fields) => logs.push(JSON.stringify({ event, ...fields }));
  const done = serve(
    input,
    output,
    { client, session: new Session(), agent, receiptLink: receiptLinker(RECEIPTS) },
    log,
  );

  const waiting = new Map<unknown, (message: Record<string, unknown>) => void>();
  const unmatched: Record<string, unknown>[] = [];
  createInterface({ input: output }).on("line", (line) => {
    const message = JSON.parse(line) as Record<string, unknown>;
    const resolve = waiting.get(message.id);
    if (resolve) resolve(message);
    else unmatched.push(message);
  });

  let nextId = 1;
  const request = (method: string, params?: unknown) => {
    const id = nextId++;
    const reply = new Promise<Record<string, unknown>>((resolve) => waiting.set(id, resolve));
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return reply;
  };
  const call = async (name: string, args: unknown) => {
    const reply = await request("tools/call", { name, arguments: args });
    const result = reply.result as {
      structuredContent: Envelope;
      isError: boolean;
      content: { text: string }[];
    };
    expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent);
    return { envelope: result.structuredContent, isError: result.isError };
  };
  const stop = async () => {
    input.end();
    await done;
  };
  return { api, request, call, stop, logs, unmatched, raw: (line: string) => input.write(`${line}\n`) };
}

describe("stdio MCP server", () => {
  it("initializes, answers ping and lists the four tools", async () => {
    const server = start({});
    const init = await server.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "fliq" },
    });
    server.raw(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
    expect((await server.request("ping")).result).toEqual({});
    const list = (await server.request("tools/list")).result as {
      tools: { name: string; inputSchema: object }[];
    };
    expect(list.tools.map((tool) => tool.name)).toEqual([
      "cashout_quote",
      "cashout_verify_account",
      "cashout_pay",
      "cashout_status",
    ]);
    expect(list.tools).toEqual(TOOL_DEFINITIONS);
    await server.stop();
    expect(server.unmatched).toEqual([]);
  });

  it("offers its newest protocol version to a client asking for an unknown one", async () => {
    const server = start({});
    const init = await server.request("initialize", { protocolVersion: "1999-01-01", capabilities: {} });
    expect((init.result as { protocolVersion: string }).protocolVersion).toBe(PROTOCOL_VERSIONS[0]);
    await server.stop();
  });

  it("answers JSON-RPC errors for bad JSON, unknown methods and unknown tools", async () => {
    const server = start({});
    server.raw("{not json");
    expect((await server.request("resources/list")).error).toMatchObject({ code: -32601 });
    expect((await server.request("tools/call", { name: "cashout_nope", arguments: {} })).error).toMatchObject(
      {
        code: -32602,
      },
    );
    await server.stop();
    expect(server.unmatched).toEqual([
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } },
    ]);
  });

  it("returns the top three offered routes from a quote", async () => {
    const server = start({ "POST /quotes": { status: 200, body: quote } });
    const { envelope, isError } = await server.call("cashout_quote", { amount: "50.00", currency: "ngn" });
    expect(isError).toBe(false);
    expect(envelope).toMatchObject({
      status: "ok",
      provider_of_record: "paycrest",
      data: { quote_id: "q_31ad77e0" },
    });
    expect(
      (envelope.data as { routes: { provider: string }[] }).routes.map((route) => route.provider),
    ).toEqual(["paycrest", "busha", "fonbnk"]);
    expect(server.api.requests[0]?.body).toEqual({ token: "usdc", amount: "50.00", currency: "ngn" });
    await server.stop();
  });

  it("refuses to pay a recipient that was not verified in this session", async () => {
    const server = start({ "POST /payouts": { status: 201, body: created } });
    const { envelope, isError } = await server.call("cashout_pay", { quote_id: "q_31ad77e0", recipient });
    expect(isError).toBe(true);
    expect(envelope.status).toBe("refused");
    expect(envelope.summary).toContain("cashout_verify_account");
    expect(server.api.requests).toEqual([]);
    await server.stop();
  });

  it("verifies, then pays with deposit instructions when there is no agent key", async () => {
    const server = start({
      "POST /quotes": { status: 200, body: quote },
      "POST /accounts/verify": { status: 200, body: verified },
      "POST /payouts": { status: 201, body: created },
    });
    await server.call("cashout_quote", { amount: "50.00", currency: "ngn" });
    const check = await server.call("cashout_verify_account", recipient);
    expect(check.envelope).toMatchObject({
      status: "ok",
      data: { account_name: "DARA OKONKWO", institution: "GTBank", account_last4: "6789" },
    });

    const { envelope, isError } = await server.call("cashout_pay", { quote_id: "q_31ad77e0", recipient });
    expect(isError).toBe(false);
    expect(envelope).toMatchObject({
      status: "awaiting_deposit",
      provider_of_record: "paycrest",
      receipt_link: "https://receipts.example/po_9c2f71aa",
      data: {
        payout_id: "po_9c2f71aa",
        deposit: { chain: "near", address: "fliq-vault.testnet", amount: "50.00" },
      },
    });
    expect(envelope.summary).toBe(
      "Send 50.00 USDC on near to fliq-vault.testnet; then 68,816 NGN goes to DARA OKONKWO through paycrest.",
    );
    const payRequest = server.api.requests.find((request) => request.path === "/payouts");
    expect(payRequest?.headers["idempotency-key"]).toBe("fliq-mcp-q_31ad77e0");
    expect(payRequest?.body).toEqual({
      quote_id: "q_31ad77e0",
      account: { bank: "058", number: "0123456789" },
    });
    await server.stop();
    expect(server.logs.join("\n")).not.toMatch(/0123456789|DARA|OKONKWO/);
  });

  it("refuses a pay request naming a route the quote does not pay through", async () => {
    const server = start({
      "POST /quotes": { status: 200, body: quote },
      "POST /accounts/verify": { status: 200, body: verified },
    });
    await server.call("cashout_quote", { amount: "50.00", currency: "ngn" });
    await server.call("cashout_verify_account", recipient);
    const { envelope } = await server.call("cashout_pay", {
      quote_id: "q_31ad77e0",
      recipient,
      provider: "busha",
    });
    expect(envelope.status).toBe("refused");
    expect(server.api.requests.some((request) => request.path === "/payouts")).toBe(false);
    await server.stop();
  });

  it("reports a bank that cannot find the account as not_found", async () => {
    const server = start({
      "POST /accounts/verify": {
        status: 404,
        body: { error: { code: "account_not_found", message: "Not found." } },
      },
    });
    const { envelope, isError } = await server.call("cashout_verify_account", recipient);
    expect(envelope.status).toBe("not_found");
    expect(isError).toBe(false);
    await server.stop();
  });

  it("rejects invalid input as a tool error without calling the API", async () => {
    const server = start({});
    const { envelope, isError } = await server.call("cashout_verify_account", {
      ...recipient,
      number: "12-34",
    });
    expect(isError).toBe(true);
    expect(envelope).toMatchObject({
      status: "invalid_input",
      summary: "arguments.number is not in the expected format.",
    });
    expect(server.api.requests).toEqual([]);
    await server.stop();
  });

  it("gives the state, timeline, hashes and receipt link of a payout", async () => {
    const server = start({ "GET /payouts/po_9c2f71aa": { status: 200, body: settled } });
    const { envelope } = await server.call("cashout_status", { payout_id: "po_9c2f71aa" });
    expect(envelope).toMatchObject({
      status: "ok",
      summary: "68,816 NGN reached DARA OKONKWO's account through paycrest in 21 seconds.",
      receipt_link: "https://receipts.example/po_9c2f71aa",
      data: {
        state: "settled",
        final: true,
        hashes: {
          provider_order: "pc_8c9d1a4b10",
          vault_receipt: "ord_7f3a9ec21e",
          bank_reference: "000013251029140213",
        },
        account: { last4: "6789" },
      },
    });
    expect((envelope.data as { timeline: unknown[] }).timeline).toHaveLength(4);
    expect(JSON.stringify(envelope)).not.toContain("0123456789");
    await server.stop();
  });
});

describe("stdio MCP server with a vault agent key", () => {
  async function agent(): Promise<VaultAgent> {
    const rpc = (async () =>
      new Response(
        JSON.stringify({ result: { nonce: 41, block_height: 5_000 } }),
      )) as unknown as typeof fetch;
    const key = newUser("agent-1.ada.fliq.testnet").key.toString();
    return createVaultAgent(
      {
        accountId: "agent-1.ada.fliq.testnet",
        secretKey: key,
        nearRpcUrl: "http://rpc.test",
        vaultContractId: VAULT,
      },
      rpc,
    );
  }

  async function payWith(relay: Routes[string]) {
    const server = start(
      {
        "POST /accounts/verify": { status: 200, body: verified },
        "POST /payouts": { status: 201, body: vaultOrder },
        "POST /relays": relay,
      },
      await agent(),
    );
    await server.call("cashout_verify_account", recipient);
    const result = await server.call("cashout_pay", { quote_id: "q_31ad77e0", recipient });
    await server.stop();
    return { ...result, server };
  }

  it("signs the vault payout and relays it", async () => {
    const { envelope, server } = await payWith({
      status: 200,
      body: { ...relayFailed, status: "succeeded", failures: [] },
    });
    expect(envelope).toMatchObject({ status: "paid", refund_address: "vault" });
    const relayed = server.api.requests.find((request) => request.path === "/relays");
    expect(relayed?.body).toMatchObject({ signed_delegate: expect.stringMatching(/^[A-Za-z0-9+/]+=*$/) });
  });

  it("says the payout is blocked while the API refuses agent relays from an API key", async () => {
    const { envelope, isError } = await payWith({
      status: 403,
      body: {
        error: {
          code: "forbidden",
          message: "API keys cannot call this endpoint. Sign in to the dashboard instead.",
        },
      },
    });
    expect(isError).toBe(true);
    expect(envelope.status).toBe("blocked");
    expect(envelope.summary).toContain("Nothing has moved");
  });

  it("reports a cap refusal from the vault as refused", async () => {
    const { envelope, isError } = await payWith({
      status: 200,
      body: {
        ...relayFailed,
        failures: [
          '{"ActionError":{"index":0,"kind":{"FunctionCallError":{"ExecutionError":"Smart contract panicked: fliq_vault: POLICY_DAILY_CAP"}}}}',
        ],
      },
    });
    expect(isError).toBe(true);
    expect(envelope.status).toBe("refused");
    expect(envelope.summary).toContain("POLICY_DAILY_CAP");
  });
});
