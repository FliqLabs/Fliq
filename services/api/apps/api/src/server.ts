import { createOneClickClient } from "../../../packages/chains/oneclick/index.js";
import { MockVault } from "../../../packages/chains/vault/index.js";
import { DEFAULT_ROUTING_CONFIG, NO_SIGNALS } from "../../../packages/domain/routing.js";
import { createPaycrestAdapter } from "../../../packages/providers/paycrest/paycrest.js";
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
import { createWebhookHandler } from "./webhooks.js";

const config = loadConfig();
const unit = unitOf(createDatabase());

// Real Paycrest when a key is set, otherwise the sandbox provider so a fresh clone needs no keys.
const adapters = process.env.PAYCREST_API_KEY
  ? [
      createPaycrestAdapter({
        apiKey: process.env.PAYCREST_API_KEY,
        webhookSecrets: [process.env.PAYCREST_WEBHOOK_SECRET ?? ""],
        deps: { alert: (alert) => console.warn(`[provider alert] ${alert.provider} ${alert.kind}`) },
      }),
    ]
  : sandboxAdapters();

// Until a testnet deployment exists, the vault is Ladipeo's in-memory model.
const vault = new MockVault({
  registrar: process.env.NEAR_REGISTRATION_ACCOUNT_ID ?? "registrar.test.near",
  usdc: process.env.USDC_CONTRACT_ID ?? "usdc.test.near",
  now: () => BigInt(Date.now()) * 1_000_000n,
});

// Paycrest takes no NEAR, so a NEAR sender reaches it through 1Click. Without a 1Click URL there is no hop.
const hops = process.env.ONECLICK_URL
  ? new OneClickHops({
      client: createOneClickClient({ baseUrl: process.env.ONECLICK_URL, apiKey: process.env.ONECLICK_API_KEY || undefined }),
      slippageBps: Number(process.env.ONECLICK_SLIPPAGE_BPS ?? 50),
      pricingRefundTo: config.vaultAccount,
      pricingRecipient: process.env.ONECLICK_PRICING_RECIPIENT ?? "0x0000000000000000000000000000000000000001",
    })
  : undefined;

const handlers = createHandlers({
  config,
  unit,
  email: createEmailSender(config),
  provisioner: new MockProvisioner(config.vaultAccount, (account) => vault.registerStorage(account)),
  vault,
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
  webhooks: createWebhookHandler({ unit, adapters }) });
await app.listen({ port: config.port, host: "0.0.0.0" });
