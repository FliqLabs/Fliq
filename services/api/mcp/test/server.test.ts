import { describe, expect, it } from "vitest";
import type { Payout } from "../../sdk/src/index.js";
import { API_KEY, fixture, type Recorded } from "../../sdk/test/fake-api.js";
import { PROTOCOL_VERSIONS } from "../src/server.js";
import { instructionsFor, toolsFor } from "../src/tools/definitions.js";
import { startFromEnv, type Routes } from "./harness.js";

const quote = fixture("quote.usdc-ngn-50.json");
const verified = fixture("verify.gtbank-0123456789.json");
const created = fixture<Payout>("payout.created.json");
const settled = fixture<Payout>("payout.settled.json");
// What the API returns for a payout funded from the vault: vault_receipt is the payout id, the vault order id.
const vaultOrder: Payout = { ...created, vault_receipt: created.payout_id };

const recipient = { country: "ng", bank: "058", number: "0123456789" };
const BASE_ADDRESS = "0x1111111111111111111111111111111111111111";
const SOLANA_ADDRESS = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";

// Like POST /v1/payouts since #132: a payout funded on base, polygon or solana needs a refund address there.
function payouts(reply: Payout = created) {
  return (request: Recorded) => {
    const body = request.body as { refund_address?: string };
    if (!body.refund_address) {
      return {
        status: 400,
        body: {
          error: {
            code: "invalid_request",
            message: "refund_address is required for a payout funded on base.",
          },
        },
      };
    }
    return { status: 201, body: reply };
  };
}

const start = (routes: Routes, env: Record<string, string> = {}, now?: () => number) =>
  startFromEnv(routes, { FLIQ_API_KEY: API_KEY, ...env }, now);

async function verifiedSession(routes: Routes, env: Record<string, string> = {}, now?: () => number) {
  const server = await start(
    {
      "POST /quotes": { status: 200, body: quote },
      "POST /accounts/verify": { status: 200, body: verified },
      ...routes,
    },
    env,
    now,
  );
  await server.call("cashout_quote", { amount: "50.00", currency: "ngn" });
  await server.call("cashout_verify_account", recipient);
  return server;
}

const payRequest = (requests: Recorded[]) => requests.find((request) => request.path === "/payouts");

describe("stdio MCP server in developer mode", () => {
  it("initializes, answers ping and lists the four developer tools", async () => {
    const server = await start({});
    const init = await server.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "fliq" },
      instructions: instructionsFor("developer"),
    });
    server.raw(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
    expect((await server.request("ping")).result).toEqual({});
    const list = (await server.request("tools/list")).result as { tools: { name: string }[] };
    expect(list.tools.map((tool) => tool.name)).toEqual([
      "cashout_quote",
      "cashout_verify_account",
      "cashout_pay",
      "cashout_status",
    ]);
    expect(list.tools).toEqual(toolsFor("developer"));
    await server.stop();
    expect(server.unmatched).toEqual([]);
  });

  it("offers its newest protocol version to a client asking for an unknown one", async () => {
    const server = await start({});
    const init = await server.request("initialize", { protocolVersion: "1999-01-01", capabilities: {} });
    expect((init.result as { protocolVersion: string }).protocolVersion).toBe(PROTOCOL_VERSIONS[0]);
    await server.stop();
  });

  it("answers JSON-RPC errors for bad JSON, unknown methods and tools of the other mode", async () => {
    const server = await start({});
    server.raw("{not json");
    expect((await server.request("resources/list")).error).toMatchObject({ code: -32601 });
    expect((await server.request("tools/call", { name: "cashout_nope", arguments: {} })).error).toMatchObject(
      {
        code: -32602,
      },
    );
    expect(
      (await server.request("tools/call", { name: "cashout_limits", arguments: {} })).error,
    ).toMatchObject({
      code: -32602,
    });
    await server.stop();
    expect(server.unmatched).toEqual([
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } },
    ]);
  });

  it("quotes from base by default and returns the top three offered routes", async () => {
    const server = await start({ "POST /quotes": { status: 200, body: quote } });
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
    expect(server.api.requests[0]?.body).toEqual({
      token: "usdc",
      amount: "50.00",
      currency: "ngn",
      source_chain: "base",
    });
    await server.stop();
  });

  it("quotes from FLIQ_SOURCE_CHAIN and refuses near, which an API key cannot pay from", async () => {
    const server = await start(
      { "POST /quotes": { status: 200, body: quote } },
      { FLIQ_SOURCE_CHAIN: "polygon" },
    );
    await server.call("cashout_quote", { amount: "50.00", currency: "ngn" });
    expect(server.api.requests[0]?.body).toMatchObject({ source_chain: "polygon" });
    const near = await server.call("cashout_quote", {
      amount: "50.00",
      currency: "ngn",
      source_chain: "near",
    });
    expect(near.envelope.status).toBe("invalid_input");
    expect(server.api.requests).toHaveLength(1);
    await server.stop();
  });

  it("refuses to pay a recipient that was not verified in this session", async () => {
    const server = await start({ "POST /payouts": payouts() });
    const { envelope, isError } = await server.call("cashout_pay", { quote_id: "q_31ad77e0", recipient });
    expect(isError).toBe(true);
    expect(envelope.status).toBe("refused");
    expect(envelope.summary).toContain("cashout_verify_account");
    expect(server.api.requests).toEqual([]);
    await server.stop();
  });

  it("asks for a refund address on the quote's chain before calling the API", async () => {
    const server = await verifiedSession({ "POST /payouts": payouts() });
    const { envelope, isError } = await server.call("cashout_pay", { quote_id: "q_31ad77e0", recipient });
    expect(isError).toBe(false);
    expect(envelope).toMatchObject({
      status: "needs_refund_address",
      data: { quote_id: "q_31ad77e0", source_chain: "base" },
    });
    expect(envelope.summary).toContain("base address");
    expect(payRequest(server.api.requests)).toBeUndefined();
    await server.stop();
  });

  it("verifies, then pays with the refund address and the verified name and returns deposit instructions", async () => {
    const server = await verifiedSession({ "POST /payouts": payouts() });
    const { envelope, isError } = await server.call("cashout_pay", {
      quote_id: "q_31ad77e0",
      recipient,
      refund_address: BASE_ADDRESS,
    });
    expect(isError).toBe(false);
    expect(envelope).toMatchObject({
      status: "awaiting_deposit",
      provider_of_record: "paycrest",
      refund_address: BASE_ADDRESS,
      receipt_link: "https://receipts.example/po_9c2f71aa",
      data: {
        payout_id: "po_9c2f71aa",
        deposit: { chain: "near", address: "fliq-vault.testnet", amount: "50.00" },
      },
    });
    expect(envelope.summary).toBe(
      "Send 50.00 USDC on near to fliq-vault.testnet; then 68,816 NGN goes to DARA OKONKWO through paycrest.",
    );
    const request = payRequest(server.api.requests);
    expect(request?.headers["idempotency-key"]).toBe("fliq-mcp-q_31ad77e0");
    expect(request?.body).toEqual({
      quote_id: "q_31ad77e0",
      account: { bank: "058", number: "0123456789" },
      refund_address: BASE_ADDRESS,
      account_name: "DARA OKONKWO",
    });
    await server.stop();
    expect(server.logs.join("\n")).not.toMatch(/0123456789|DARA|OKONKWO/);
  });

  it("uses FLIQ_REFUND_ADDRESS only when it is an address on the quote's chain", async () => {
    const fits = await verifiedSession({ "POST /payouts": payouts() }, { FLIQ_REFUND_ADDRESS: BASE_ADDRESS });
    const paid = await fits.call("cashout_pay", { quote_id: "q_31ad77e0", recipient });
    expect(paid.envelope.status).toBe("awaiting_deposit");
    expect(payRequest(fits.api.requests)?.body).toMatchObject({ refund_address: BASE_ADDRESS });
    await fits.stop();

    const wrongChain = await verifiedSession(
      { "POST /payouts": payouts() },
      { FLIQ_REFUND_ADDRESS: SOLANA_ADDRESS },
    );
    const asked = await wrongChain.call("cashout_pay", { quote_id: "q_31ad77e0", recipient });
    expect(asked.envelope.status).toBe("needs_refund_address");
    const typo = await wrongChain.call("cashout_pay", {
      quote_id: "q_31ad77e0",
      recipient,
      refund_address: "0x12",
    });
    expect(typo.envelope).toMatchObject({
      status: "invalid_input",
      summary: "refund_address must be an address on base.",
    });
    expect(payRequest(wrongChain.api.requests)).toBeUndefined();
    await wrongChain.stop();
  });

  it("passes the API's refusal through for a quote from another session without a refund address", async () => {
    const server = await start({
      "POST /accounts/verify": { status: 200, body: verified },
      "POST /payouts": payouts(),
    });
    await server.call("cashout_verify_account", recipient);
    const { envelope, isError } = await server.call("cashout_pay", { quote_id: "q_31ad77e0", recipient });
    expect(isError).toBe(true);
    expect(envelope).toMatchObject({
      status: "error",
      summary: "refund_address is required for a payout funded on base.",
      data: { code: "invalid_request", http_status: 400 },
    });
    await server.stop();
  });

  it("turns the payout's account_name_required into name_required", async () => {
    const server = await verifiedSession({
      "POST /payouts": {
        status: 422,
        body: { error: { code: "account_name_required", message: "Type the account name." } },
      },
    });
    const { envelope, isError } = await server.call("cashout_pay", {
      quote_id: "q_31ad77e0",
      recipient,
      refund_address: BASE_ADDRESS,
    });
    expect(isError).toBe(false);
    expect(envelope.status).toBe("name_required");
    expect(envelope.summary).toContain("account_name");
    await server.stop();
  });

  it("says a vault order needs agent mode and never relays it with the API key", async () => {
    const server = await verifiedSession({ "POST /payouts": payouts(vaultOrder) });
    const { envelope, isError } = await server.call("cashout_pay", {
      quote_id: "q_31ad77e0",
      recipient,
      refund_address: BASE_ADDRESS,
    });
    expect(isError).toBe(true);
    expect(envelope.status).toBe("blocked");
    expect(envelope.summary).toContain("agent mode");
    expect(envelope.summary).not.toContain("fliq app");
    expect(server.api.requests.some((request) => request.path.startsWith("/relays"))).toBe(false);
    await server.stop();
  });

  it("refuses a quote that expired before the pay call", async () => {
    let now = 1_000_000;
    const server = await verifiedSession({ "POST /payouts": payouts() }, {}, () => now);
    now += 91_000;
    const { envelope } = await server.call("cashout_pay", {
      quote_id: "q_31ad77e0",
      recipient,
      refund_address: BASE_ADDRESS,
    });
    expect(envelope.status).toBe("refused");
    expect(envelope.summary).toContain("expired");
    expect(payRequest(server.api.requests)).toBeUndefined();
    await server.stop();
  });

  it("refuses a pay request naming a route the quote does not pay through", async () => {
    const server = await verifiedSession({});
    const { envelope } = await server.call("cashout_pay", {
      quote_id: "q_31ad77e0",
      recipient,
      provider: "busha",
      refund_address: BASE_ADDRESS,
    });
    expect(envelope.status).toBe("refused");
    expect(payRequest(server.api.requests)).toBeUndefined();
    await server.stop();
  });

  it("reports a bank that cannot find the account as not_found", async () => {
    const server = await start({
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
    const server = await start({});
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
    const server = await start({ "GET /payouts/po_9c2f71aa": { status: 200, body: settled } });
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
