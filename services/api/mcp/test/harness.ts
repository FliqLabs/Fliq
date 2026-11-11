import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { expect } from "vitest";
import { fakeApi } from "../../sdk/test/fake-api.js";
import { contextFrom, readConfig } from "../src/config.js";
import { serve, type Log } from "../src/server.js";
import type { Envelope } from "../src/tools/envelope.js";
import type { ToolContext } from "../src/tools/handlers.js";

export type Routes = Parameters<typeof fakeApi>[0];

export const RECEIPTS = "https://receipts.example/{payout_id}";

// Starts the server the way bin.ts does, from environment variables, against a fake API.
export async function startFromEnv(routes: Routes, env: Record<string, string>, now?: () => number) {
  const api = fakeApi(routes);
  const context = await contextFrom(
    readConfig({ FLIQ_API_URL: "http://localhost:4000/v1", FLIQ_RECEIPT_URL: RECEIPTS, ...env }),
    { fetch: api.fetch, now },
  );
  return { api, ...connect(context) };
}

function connect(context: ToolContext) {
  const input = new PassThrough();
  const output = new PassThrough();
  const logs: string[] = [];
  const log: Log = (event, fields) => logs.push(JSON.stringify({ event, ...fields }));
  const done = serve(input, output, context, log);

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
  const call = async (name: string, args: unknown = {}) => {
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
  return { request, call, stop, logs, unmatched, raw: (line: string) => input.write(`${line}\n`) };
}
