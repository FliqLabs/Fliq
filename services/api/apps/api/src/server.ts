import { Redis } from "ioredis";
import { createOneClickClient } from "../../../packages/chains/oneclick/index.js";
import { MockVault } from "../../../packages/chains/vault/index.js";
import { DEFAULT_ROUTING_CONFIG, NO_SIGNALS } from "../../../packages/domain/routing.js";
import { withCache } from "../../../packages/providers/cache.js";
import { enabledAdapters } from "../../../packages/providers/enabled.js";
import { MockProvisioner } from "./accounts.js";
import { buildApp } from "./app.js";
import { createEmailSender } from "./auth/email-links.js";
import { loadConfig } from "./config.js";
import { createDatabase, unitOf } from "./db.js";
import { createHandlers } from "./handlers.js";
import { OneClickHops } from "./hop.js";
import { DEFAULT_DEADLINE_MARGIN_MS, DEFAULT_GUARD_BPS, DEFAULT_VELOCITY } from "./payouts.js";
import { createLimiter } from "./rate-limit.js";
import { sandboxAdapters } from "./sandbox.js";
import { startHealthChecks, type Probe } from "./status.js";
import { createWebhookHandler } from "./webhooks.js";
import { startWebhookDelivery } from "./webhook-delivery.js";
import { httpsTransport } from "../../../packages/webhooks/transport.js";

const config = loadConfig();
const unit = unitOf(createDatabase());

// Every provider whose keys are set, otherwise the sandbox provider so a fresh clone needs no keys.
const configured = enabledAdapters(process.env, {
  alert: (alert) => console.warn(`[provider alert] ${alert.provider} ${alert.kind}`),
}).map((adapter) => withCache(adapter, { hashKey: config.hashKey }));
const adapters = configured.length > 0 ? configured : sandboxAdapters();

// Until a testnet deployment exists, the vault is Ladipeo's in-memory model.
const vault = new MockVault({
  registrar: process.env.NEAR_REGISTRATION_ACCOUNT_ID ?? "registrar.test.near",
  usdc: process.env.USDC_CONTRACT_ID ?? "usdc.test.near",
  now: () => BigInt(Date.now()) * 1_000_000n,
});

// Paycrest takes no NEAR, so a NEAR sender reaches it through 1Click. Without a 1Click URL there is no hop.
const oneClick = process.env.ONECLICK_URL
  ? createOneClickClient({ baseUrl: process.env.ONECLICK_URL, apiKey: process.env.ONECLICK_API_KEY || undefined })
  : undefined;
const hops = oneClick
  ? new OneClickHops({
      client: oneClick,
      slippageBps: Number(process.env.ONECLICK_SLIPPAGE_BPS ?? 50),
      pricingRefundTo: config.vaultAccount,
      pricingRecipient: process.env.ONECLICK_PRICING_RECIPIENT ?? "0x0000000000000000000000000000000000000001",
    })
  : undefined;

const ok = { result: "ok" } as const;
const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false }) : undefined;
const probes: Probe[] = [
  { id: "api", name: "API", kind: "service", run: async () => ok },
  { id: "database", name: "Database", kind: "service", run: async () => (await unit((tx) => tx.$queryRaw`SELECT 1`), ok) },
  ...(redis ? [{ id: "redis", name: "Redis", kind: "service" as const, run: async () => ((await redis.ping()) === "PONG" ? ok : { result: "down" as const }) }] : []),
  ...(oneClick ? [{ id: "near_intents", name: "NEAR Intents", kind: "service" as const, run: async () => ((await oneClick.tokens()).length > 0 ? ok : { result: "down" as const }) }] : []),
  { id: "vault", name: "Vault", kind: "service", run: async () => (await vault.getBalance("registrar.test.near"), ok) },
  ...adapters.map((adapter) => ({
    id: adapter.id,
    name: adapter.id.charAt(0).toUpperCase() + adapter.id.slice(1),
    kind: "provider" as const,
    run: async () => ((await adapter.health()).healthy ? ok : { result: "down" as const }),
  })),
];

const handlers = createHandlers({
  config,
  unit,
  email: createEmailSender(config),
  provisioner: new MockProvisioner(config.vaultAccount, (account) => vault.registerStorage(account)),
  vault,
  status: { probes },
  quotes: { adapters, ...(hops ? { hop: hops } : {}), routing: DEFAULT_ROUTING_CONFIG, signals: NO_SIGNALS, now: () => new Date() },
  payouts: {
    config,
    adapters,
    velocity: DEFAULT_VELOCITY,
    now: () => new Date(),
    ...(hops ? { intents: { hops, vault, guardBps: DEFAULT_GUARD_BPS, deadlineMarginMs: Number(process.env.ONECLICK_DEADLINE_MARGIN_MS ?? DEFAULT_DEADLINE_MARGIN_MS) } } : {}),
  },
});

const app = buildApp({ config, unit, handlers, logger: true, limiter: createLimiter(process.env.REDIS_URL),
  webhooks: createWebhookHandler({ unit, adapters, dataKey: config.dataKey }) });
await app.listen({ port: config.port, host: "0.0.0.0" });
startHealthChecks(unit, probes, Number(process.env.HEALTH_CHECK_INTERVAL_MS ?? 60_000));
startWebhookDelivery(
  { unit, config, transport: httpsTransport(), now: () => new Date() },
  Number(process.env.WEBHOOK_POLL_INTERVAL_MS ?? 2_000),
  (message) => app.log.error(message),
);
