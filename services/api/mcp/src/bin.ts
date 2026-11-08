#!/usr/bin/env node
import { FliqClient } from "../../sdk/src/index.js";
import { createVaultAgent } from "./agent/vault-agent.js";
import { readConfig, receiptLinker } from "./config.js";
import { serve, stderrLog, SERVER_VERSION } from "./server.js";
import { Session } from "./tools/session.js";

async function main(): Promise<void> {
  const log = stderrLog();
  const config = readConfig(process.env);
  const client = new FliqClient({ apiKey: config.apiKey, baseUrl: config.apiUrl });
  const agent = config.agent ? await createVaultAgent(config.agent) : undefined;
  log("started", { version: SERVER_VERSION, api: client.baseUrl, agent: agent !== undefined });
  await serve(
    process.stdin,
    process.stdout,
    { client, session: new Session(), agent, receiptLink: receiptLinker(config.receiptUrl) },
    log,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`fliq-mcp: ${error instanceof Error ? error.message : "failed to start"}\n`);
  process.exit(1);
});
