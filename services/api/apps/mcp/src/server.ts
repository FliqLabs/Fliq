import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createNearRpc } from "../../../packages/chains/near/index.js";
import { AgentClient } from "./client.js";
import { TOOLS } from "./tools.js";

// MCP over stdio is newline-delimited JSON-RPC 2.0; these are the methods an MCP host calls on a tools-only server.
const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

type Message = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type Response = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const reply = (id: Message["id"], result: unknown): Response => ({ jsonrpc: "2.0", id: id ?? null, result });
const fail = (id: Message["id"], code: number, message: string): Response => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

export function createMcpHandler(client: AgentClient) {
  return async function handle(message: Message): Promise<Response | null> {
    if (message.id === undefined) return null;
    switch (message.method) {
      case "initialize": {
        const asked = String(message.params?.protocolVersion ?? "");
        return reply(message.id, {
          protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: "fliq", version: "0.1.0" },
        });
      }
      case "ping":
        return reply(message.id, {});
      case "tools/list":
        return reply(message.id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      case "tools/call": {
        const tool = TOOLS.find((candidate) => candidate.name === message.params?.name);
        if (!tool) return fail(message.id, -32602, `Unknown tool ${String(message.params?.name)}`);
        try {
          const answer = await tool.run(client, (message.params?.arguments ?? {}) as Record<string, unknown>);
          return reply(message.id, { content: [{ type: "text", text: JSON.stringify(answer.body, null, 2) }], isError: answer.status >= 400 });
        } catch (error) {
          return reply(message.id, { content: [{ type: "text", text: (error as Error).message }], isError: true });
        }
      }
      default:
        return fail(message.id, -32601, `Method not found: ${String(message.method)}`);
    }
  };
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const client = new AgentClient({
    apiUrl: required("FLIQ_API_URL"),
    agentId: required("FLIQ_AGENT_ID"),
    privateKey: readFileSync(required("FLIQ_AGENT_KEY_FILE"), "utf8").trim(),
    rpc: createNearRpc({ url: required("NEAR_RPC_URL") }),
  });
  const handle = createMcpHandler(client);
  // stdout carries only protocol messages; anything else goes to stderr so the host can show it.
  const lines = createInterface({ input: process.stdin });
  lines.on("line", async (line) => {
    if (!line.trim()) return;
    let message: Message;
    try {
      message = JSON.parse(line) as Message;
    } catch {
      process.stdout.write(`${JSON.stringify(fail(null, -32700, "Parse error"))}\n`);
      return;
    }
    const response = await handle(message);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
  console.error(`fliq MCP server ready as ${process.env.FLIQ_AGENT_ID}`);
}
