import type { AgentConfig } from "./agent/vault-agent.js";

export interface McpConfig {
  apiKey: string;
  apiUrl: string | undefined;
  receiptUrl: string | undefined;
  agent: AgentConfig | undefined;
}

const AGENT_VARIABLES = [
  "FLIQ_AGENT_ACCOUNT_ID",
  "FLIQ_AGENT_PRIVATE_KEY",
  "FLIQ_NEAR_RPC_URL",
  "FLIQ_VAULT_CONTRACT_ID",
] as const;

export function readConfig(env: Record<string, string | undefined>): McpConfig {
  const apiKey = env.FLIQ_API_KEY?.trim();
  if (!apiKey) throw new Error("Set FLIQ_API_KEY to a fliq API key (rt_test_... or rt_live_...).");
  const receiptUrl = env.FLIQ_RECEIPT_URL?.trim() || undefined;
  if (receiptUrl && !receiptUrl.includes("{payout_id}"))
    throw new Error("FLIQ_RECEIPT_URL must contain {payout_id}.");
  return { apiKey, apiUrl: env.FLIQ_API_URL?.trim() || undefined, receiptUrl, agent: agentConfig(env) };
}

// All four or none: a half-configured agent would fail at the moment of paying instead of at start.
function agentConfig(env: Record<string, string | undefined>): AgentConfig | undefined {
  const values = AGENT_VARIABLES.map((name) => env[name]?.trim() || undefined);
  if (values.every((value) => value === undefined)) return undefined;
  const missing = AGENT_VARIABLES.filter((_, i) => values[i] === undefined);
  if (missing.length > 0) throw new Error(`The vault agent also needs ${missing.join(", ")}.`);
  const [accountId, secretKey, nearRpcUrl, vaultContractId] = values as string[];
  return {
    accountId: accountId!,
    secretKey: secretKey!,
    nearRpcUrl: nearRpcUrl!,
    vaultContractId: vaultContractId!,
  };
}

export function receiptLinker(template: string | undefined): (payoutId: string) => string | null {
  return (payoutId) => (template ? template.replace("{payout_id}", encodeURIComponent(payoutId)) : null);
}
