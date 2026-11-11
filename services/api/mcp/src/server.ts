import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { instructionsFor, toolsFor } from "./tools/definitions.js";
import { isFailure } from "./tools/envelope.js";
import { callTool, isToolName, type ToolContext } from "./tools/handlers.js";

export const SERVER_NAME = "fliq";
export const SERVER_VERSION = "0.1.1";
// Newest first. A client asking for one of these gets it back; any other request gets the newest.
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

type Id = string | number | null;
type Message = { jsonrpc?: unknown; id?: Id; method?: unknown; params?: unknown };
type Reply = { result: unknown } | { error: { code: number; message: string } };

// Only method names, tool names, outcomes and timings: never arguments, which carry names and account numbers.
export type Log = (event: string, fields?: Record<string, string | number | boolean | null>) => void;

export function stderrLog(): Log {
  return (event, fields = {}) =>
    process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), event, ...fields })}\n`);
}

// MCP stdio transport: one JSON-RPC 2.0 message per line in each direction. Resolves when the input ends and
// every request in flight has been answered.
export async function serve(
  input: Readable,
  output: Writable,
  context: ToolContext,
  log: Log,
): Promise<void> {
  const pending = new Set<Promise<void>>();
  const send = (message: object) => output.write(`${JSON.stringify(message)}\n`);
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const handled = handleLine(line, context, log).then((response) => {
      if (response) send(response);
    });
    pending.add(handled);
    void handled.finally(() => pending.delete(handled));
  }
  await Promise.all(pending);
}

async function handleLine(line: string, context: ToolContext, log: Log): Promise<object | null> {
  let message: Message;
  try {
    message = JSON.parse(line) as Message;
  } catch {
    return { jsonrpc: "2.0", id: null, error: { code: PARSE_ERROR, message: "Parse error." } };
  }
  if (
    typeof message !== "object" ||
    message === null ||
    Array.isArray(message) ||
    message.jsonrpc !== "2.0"
  ) {
    return {
      jsonrpc: "2.0",
      id: null,
      error: { code: INVALID_REQUEST, message: "Not a JSON-RPC 2.0 message." },
    };
  }
  if (typeof message.method !== "string") return null;
  const isNotification = !("id" in message);
  if (isNotification) return null;
  const id = message.id ?? null;
  const reply = await dispatch(message.method, message.params, context, log).catch((error: unknown) => {
    log("internal_error", {
      method: String(message.method),
      type: error instanceof Error ? error.name : "unknown",
    });
    return { error: { code: INTERNAL_ERROR, message: "Internal error." } };
  });
  return { jsonrpc: "2.0", id, ...reply };
}

async function dispatch(method: string, params: unknown, context: ToolContext, log: Log): Promise<Reply> {
  switch (method) {
    case "initialize":
      return { result: initializeResult(params, context) };
    case "ping":
      return { result: {} };
    case "tools/list":
      return { result: { tools: toolsFor(context.mode) } };
    case "tools/call":
      return toolsCall(params, context, log);
    default:
      return { error: { code: METHOD_NOT_FOUND, message: `Method not found: ${method}.` } };
  }
}

function initializeResult(params: unknown, context: ToolContext) {
  const requested = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
  const protocolVersion =
    typeof requested === "string" && PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];
  return {
    protocolVersion,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: SERVER_NAME, title: "fliq cash-out", version: SERVER_VERSION },
    instructions: instructionsFor(context.mode),
  };
}

async function toolsCall(params: unknown, context: ToolContext, log: Log): Promise<Reply> {
  const { name, arguments: args } = (params ?? {}) as { name?: unknown; arguments?: unknown };
  if (typeof name !== "string" || !isToolName(name, context.mode)) {
    return { error: { code: INVALID_PARAMS, message: `Unknown tool: ${String(name)}.` } };
  }
  const started = Date.now();
  const result = await callTool(name, args, context);
  log("tool_call", { tool: name, status: result.status, duration_ms: Date.now() - started });
  return {
    result: {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
      isError: isFailure(result),
    },
  };
}
