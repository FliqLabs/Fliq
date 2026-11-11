import { readFileSync } from "node:fs";
import { DEFAULT_BASE_URL, FliqClient } from "../../sdk/src/index.js";
import { AgentClient } from "./agent/agent-client.js";
import { agentKeyFrom } from "./agent/delegate.js";
import type { ToolContext } from "./tools/handlers.js";
import { Session } from "./tools/session.js";

export const SOURCE_CHAINS = ["base", "polygon", "solana"] as const;
export type SourceChain = (typeof SOURCE_CHAINS)[number];

export interface DeveloperMode {
  kind: "developer";
  apiKey: string;
  sourceChain: SourceChain;
  refundAddress: string | undefined;
}

export interface AgentMode {
  kind: "agent";
  agentId: string;
  secretKey: string;
  nearRpcUrl: string;
}

export interface McpConfig {
  apiUrl: string | undefined;
  receiptUrl: string | undefined;
  mode: DeveloperMode | AgentMode;
}

type Env = Record<string, string | undefined>;

const NEAR_RPC = { mainnet: "https://rpc.mainnet.fastnear.com", testnet: "https://rpc.testnet.fastnear.com" };

export function readConfig(
  env: Env,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): McpConfig {
  const value = (name: string) => env[name]?.trim() || undefined;
  const receiptUrl = value("FLIQ_RECEIPT_URL");
  if (receiptUrl && !receiptUrl.includes("{payout_id}"))
    throw new Error("FLIQ_RECEIPT_URL must contain {payout_id}.");
  return {
    apiUrl: value("FLIQ_API_URL"),
    receiptUrl,
    mode: agentMode(value, readFile) ?? developerMode(value),
  };
}

// Agent mode needs the agent's NEAR account and its key; a half-configured agent fails here, not at the moment of paying.
function agentMode(
  value: (name: string) => string | undefined,
  readFile: (path: string) => string,
): AgentMode | null {
  const agentId = value("FLIQ_AGENT_ID");
  const keyFile = value("FLIQ_AGENT_KEY_FILE");
  const inlineKey = value("FLIQ_AGENT_PRIVATE_KEY");
  if (!agentId && !keyFile && !inlineKey) return null;
  if (!agentId)
    throw new Error("Agent mode also needs FLIQ_AGENT_ID, the agent's NEAR account shown in the fliq app.");
  if (!keyFile && !inlineKey)
    throw new Error("Agent mode also needs FLIQ_AGENT_KEY_FILE or FLIQ_AGENT_PRIVATE_KEY.");
  if (keyFile && inlineKey) throw new Error("Set FLIQ_AGENT_KEY_FILE or FLIQ_AGENT_PRIVATE_KEY, not both.");
  const secretKey = keyFile ? readKeyFile(keyFile, readFile) : (inlineKey as string);
  const nearRpcUrl =
    value("FLIQ_NEAR_RPC_URL") ?? (agentId.endsWith(".testnet") ? NEAR_RPC.testnet : NEAR_RPC.mainnet);
  return { kind: "agent", agentId, secretKey, nearRpcUrl };
}

function readKeyFile(path: string, readFile: (path: string) => string): string {
  try {
    return readFile(path).trim();
  } catch {
    throw new Error(`FLIQ_AGENT_KEY_FILE could not be read: ${path}.`);
  }
}

function developerMode(value: (name: string) => string | undefined): DeveloperMode {
  const apiKey = value("FLIQ_API_KEY");
  if (!apiKey) {
    throw new Error(
      "Set FLIQ_API_KEY to a fliq API key (rt_test_... or rt_live_...), or FLIQ_AGENT_ID and FLIQ_AGENT_KEY_FILE to run as a NEAR agent.",
    );
  }
  const sourceChain = value("FLIQ_SOURCE_CHAIN") ?? "base";
  if (!isSourceChain(sourceChain))
    throw new Error(`FLIQ_SOURCE_CHAIN must be one of ${SOURCE_CHAINS.join(", ")}.`);
  return { kind: "developer", apiKey, sourceChain, refundAddress: value("FLIQ_REFUND_ADDRESS") };
}

function isSourceChain(chain: string): chain is SourceChain {
  return (SOURCE_CHAINS as readonly string[]).includes(chain);
}

export function receiptLinker(template: string | undefined): (payoutId: string) => string | null {
  return (payoutId) => (template ? template.replace("{payout_id}", encodeURIComponent(payoutId)) : null);
}

// Loads the agent key here, so a bad key stops the server at start rather than at the first payout.
export async function contextFrom(
  config: McpConfig,
  options: { fetch?: typeof fetch; now?: () => number } = {},
): Promise<ToolContext> {
  const session = new Session(options.now);
  const receiptLink = receiptLinker(config.receiptUrl);
  const baseUrl = config.apiUrl ?? DEFAULT_BASE_URL;
  const { mode } = config;
  if (mode.kind === "agent") {
    const key = await agentKeyFrom(mode.agentId, mode.secretKey);
    const agent = new AgentClient({ baseUrl, key, nearRpcUrl: mode.nearRpcUrl, ...options });
    return { mode: "agent", agent, session, receiptLink };
  }
  const client = new FliqClient({ apiKey: mode.apiKey, baseUrl, fetch: options.fetch });
  return {
    mode: "developer",
    client,
    session,
    sourceChain: mode.sourceChain,
    refundAddress: mode.refundAddress,
    receiptLink,
  };
}
