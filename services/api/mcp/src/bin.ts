#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs";
import { generateAgentKey } from "./agent/delegate.js";
import { contextFrom, readConfig } from "./config.js";
import { serve, stderrLog, SERVER_VERSION } from "./server.js";

async function main(): Promise<void> {
  if (process.argv[2] === "keygen") return keygen(process.argv[3]);
  const log = stderrLog();
  const context = await contextFrom(readConfig(process.env));
  const api = context.mode === "agent" ? context.agent.baseUrl : context.client.baseUrl;
  log("started", { version: SERVER_VERSION, api, mode: context.mode });
  await serve(process.stdin, process.stdout, context, log);
}

// Only the public key is printed: the owner pastes it into the fliq app, and the private key never leaves this file.
async function keygen(path: string | undefined): Promise<void> {
  if (!path) throw new Error("usage: fliq-mcp keygen <file to write the private key to>");
  if (existsSync(path)) throw new Error(`${path} already exists; keeping it.`);
  const { secretKey, publicKey } = await generateAgentKey();
  writeFileSync(path, `${secretKey}\n`, { mode: 0o600, flag: "wx" });
  process.stdout.write(`${publicKey}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`fliq-mcp: ${error instanceof Error ? error.message : "failed to start"}\n`);
  process.exit(1);
});
