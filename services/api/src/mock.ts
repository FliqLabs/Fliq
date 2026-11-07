import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const fixturesDir = new URL("../../../spec/fixtures/", import.meta.url);
const port = Number(process.env.PORT ?? 4000);
const testKeys = new Set(
  (process.env.FLIQ_TEST_KEYS ?? "rt_test_7Kp2demo00c9Qe,rt_test_mcp_Q8demo001fA").split(","),
);

type Route = { method: string; path: RegExp; fixture: string; status?: number; auth?: boolean };

const routes: Route[] = [
  { method: "GET", path: /^\/v1\/health$/, fixture: "health.json", auth: false },
  { method: "GET", path: /^\/v1\/rates\/usdc\/ngn$/, fixture: "rate.usdc-ngn.json", auth: false },
  { method: "GET", path: /^\/v1\/rates\/usdc\/ngn\/providers$/, fixture: "rates.board.usdc-ngn.json", auth: false },
  { method: "GET", path: /^\/v1\/rates\/usdc\/ngn\/history(\?.*)?$/, fixture: "rates.history.usdc-ngn-24h.json", auth: false },
  { method: "POST", path: /^\/v1\/quote$/, fixture: "quote.usdc-ngn-50.json" },
  { method: "POST", path: /^\/v1\/institutions\/verify$/, fixture: "verify.gtbank-0123456789.json" },
  { method: "POST", path: /^\/v1\/payouts$/, fixture: "payout.created.json", status: 201 },
  { method: "GET", path: /^\/v1\/payouts\/[\w-]+$/, fixture: "payout.settled.json" },
  { method: "POST", path: /^\/v1\/payouts\/[\w-]+\/retry-quote$/, fixture: "quote.usdc-ngn-50.json" },
  { method: "POST", path: /^\/v1\/payouts\/[\w-]+\/claims$/, fixture: "payout.claim.json", status: 201 },
  { method: "GET", path: /^\/v1\/deposits\/sources$/, fixture: "deposit.sources.json" },
  { method: "GET", path: /^\/v1\/deposits\/estimate(\?.*)?$/, fixture: "deposit.estimate.json" },
  { method: "POST", path: /^\/v1\/deposits$/, fixture: "deposit.waiting.json", status: 201 },
  { method: "GET", path: /^\/v1\/deposits\/[\w-]+$/, fixture: "deposit.landed.json" },
];

async function fixture(name: string): Promise<string> {
  return readFile(fileURLToPath(new URL(name, fixturesDir)), "utf8");
}

function send(res: ServerResponse, status: number, body: string) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

function isAuthorized(req: IncomingMessage): boolean {
  const key = req.headers.authorization?.replace(/^Bearer /, "");
  return key !== undefined && testKeys.has(key);
}

export async function handle(req: IncomingMessage, res: ServerResponse) {
  const route = routes.find((r) => r.method === req.method && r.path.test(req.url ?? ""));
  if (!route) {
    return send(res, 404, JSON.stringify({ error: { code: "not_found", message: "No such endpoint." } }));
  }
  if (route.auth !== false && !isAuthorized(req)) {
    return send(res, 401, await fixture("error.unauthorized.json"));
  }
  send(res, route.status ?? 200, await fixture(route.fixture));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handle).listen(port, () => {
    console.log(`fliq mock API on http://localhost:${port}/v1`);
  });
}
