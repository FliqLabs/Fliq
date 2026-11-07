import { createHash } from "node:crypto";
import type { Agent } from "@prisma/client";
import { baseDecode, PublicKey } from "near-api-js";
import type { Db } from "./db.js";
import { unauthorized } from "./errors.js";

export const SIGNATURE_WINDOW_SECONDS = 300;

export type AgentHeaders = { agent?: string; timestamp?: string; signature?: string };

// What an agent signs: the request line, when, and exactly the bytes it sent. The MCP server builds the same string.
export function signedMessage(method: string, pathWithQuery: string, timestamp: string, rawBody: string): string {
  const bodyHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
  return [method.toUpperCase(), pathWithQuery, timestamp, bodyHash].join("\n");
}

function verifies(publicKey: string, message: string, signature: string): boolean {
  try {
    return PublicKey.fromString(publicKey).verify(new TextEncoder().encode(message), baseDecode(signature));
  } catch {
    return false;
  }
}

// A revoked agent is turned away here; a pending one may read its limits and is stopped by the vault if it pays.
export async function authenticateAgent(tx: Db, headers: AgentHeaders, method: string, pathWithQuery: string, rawBody: string, nowSeconds: number): Promise<Agent> {
  const { agent: agentId, timestamp, signature } = headers;
  if (!agentId || !timestamp || !signature) throw unauthorized("Sign agent requests with X-Fliq-Agent, X-Fliq-Timestamp and X-Fliq-Signature.");
  const at = Number(timestamp);
  if (!/^\d{1,12}$/.test(timestamp) || Math.abs(nowSeconds - at) > SIGNATURE_WINDOW_SECONDS) {
    throw unauthorized("X-Fliq-Timestamp must be unix seconds within 5 minutes of now.");
  }
  const agent = await tx.agent.findUnique({ where: { id: agentId } });
  if (!agent || agent.state === "revoked") throw unauthorized("Unknown or revoked agent.");
  if (!verifies(agent.publicKey, signedMessage(method, pathWithQuery, timestamp, rawBody), signature)) throw unauthorized("Bad agent signature.");
  return agent;
}
