import { createOneClickClient } from "../../../packages/chains/oneclick/index.js";
import { createNearRpc, createRelayerClient, TokenStorage, type NearRpc } from "../../../packages/chains/near/index.js";
import { MockVault, NearVault, type VaultClient } from "../../../packages/chains/vault/index.js";
import { createSolanaRpc, latestSolanaArrival } from "../../../packages/chains/watchers/index.js";
import { DEFAULT_ROUTING_CONFIG, NO_SIGNALS } from "../../../packages/domain/routing.js";
import { withCache } from "../../../packages/providers/cache.js";
import { enabledAdapters } from "../../../packages/providers/enabled.js";
import { MockProvisioner, RelayerProvisioner } from "./accounts.js";
import { buildApp } from "./app.js";
import { createEmailSender } from "./auth/email-links.js";
import { loadConfig } from "./config.js";
import { createDatabase, unitOf } from "./db.js";
import { createDeposits, startDepositWatch } from "./deposits.js";
import { createHandlers } from "./handlers.js";
import { OneClickHops } from "./hop.js";
import { DEFAULT_DEADLINE_MARGIN_MS, DEFAULT_GUARD_BPS, DEFAULT_VELOCITY } from "./payouts.js";
import { createRateBoard, startRateSampler } from "./rate-board.js";
import { createLimiter } from "./rate-limit.js";
import { connectRedis, withReconnect } from "./redis.js";
import { sandboxAdapters } from "./sandbox.js";
import { startHealthChecks, type Probe } from "./status.js";
import { createWebhookHandler } from "./webhooks.js";
import { startWebhookDelivery } from "./webhook-delivery.js";
import { startVaultSync } from "./vault-sync.js";
import { payoutRefresher, startPayoutWatch } from "./payout-watch.js";
import { apnsFromEnv, createApnsSender, startPushDispatch } from "./push.js";
import { usageRecorder } from "./usage.js";
import { httpsTransport } from "../../../packages/webhooks/transport.js";

const config = loadConfig();
const unit = unitOf(createDatabase());

// Every provider whose keys are set, otherwise the sandbox provider so a fresh clone needs no keys.
const configured = enabledAdapters(process.env, {
  alert: (alert) => console.warn(`[provider alert] ${alert.provider} ${alert.kind}`),
}).map((adapter) => withCache(adapter, { hashKey: config.hashKey }));
const adapters = configured.length > 0 ? configured : sandboxAdapters();

// The deployed vault when an RPC and the registration key are set; otherwise Ladipeo's in-memory model for local runs.
const usdcContract = config.usdcContract;
const registrationAccount = process.env.NEAR_REGISTRATION_ACCOUNT_ID ?? "registrar.test.near";
const registrationKey = process.env.NEAR_REGISTRATION_PRIVATE_KEY?.trim();
const nearRpcUrl = process.env.NEAR_RPC_URL?.trim();
// Top-ups and refunds are addressed to VAULT_ACCOUNT, so the contract the backend signs for must be that same account.
if (registrationKey && process.env.VAULT_CONTRACT_ID && process.env.VAULT_CONTRACT_ID !== config.vaultAccount) {
  throw new Error("VAULT_CONTRACT_ID and VAULT_ACCOUNT name different vaults");
}
if (registrationKey && !nearRpcUrl) throw new Error("NEAR_REGISTRATION_PRIVATE_KEY is set but NEAR_RPC_URL is not");
const mockVault = registrationKey
  ? null
  : new MockVault({ registrar: registrationAccount, usdc: usdcContract, now: () => BigInt(Date.now()) * 1_000_000n });
const nearRpc = nearRpcUrl ? createNearRpc({ url: nearRpcUrl }) : null;
const vault: VaultClient =
  mockVault ??
  new NearVault({
    rpc: nearRpc as NearRpc,
    contractId: config.vaultAccount,
    registration: { accountId: registrationAccount, privateKey: registrationKey as string },
  });

const storagePayerAccount = process.env.NEAR_STORAGE_PAYER_ACCOUNT_ID?.trim();
const storagePayerKey = process.env.NEAR_STORAGE_PAYER_PRIVATE_KEY?.trim();
if (!mockVault && !(storagePayerAccount && storagePayerKey)) {
  throw new Error("The deployed vault needs NEAR_STORAGE_PAYER_ACCOUNT_ID and NEAR_STORAGE_PAYER_PRIVATE_KEY to register payout addresses");
}
const tokenStorage = mockVault
  ? { ensure: async (accountId: string) => mockVault.registerStorage(accountId) }
  : new TokenStorage({
      rpc: nearRpc as NearRpc,
      tokenContractId: usdcContract,
      payer: { accountId: storagePayerAccount as string, privateKey: storagePayerKey as string },
    });

// Paycrest takes no NEAR, so a NEAR sender reaches it through 1Click. Without a 1Click URL there is no hop.
const oneClick = process.env.ONECLICK_URL
  ? createOneClickClient({ baseUrl: process.env.ONECLICK_URL, apiKey: process.env.ONECLICK_API_KEY || undefined })
  : undefined;
const hops = oneClick
  ? new OneClickHops({
      client: oneClick,
      slippageBps: Number(process.env.ONECLICK_SLIPPAGE_BPS ?? 50),
      // 1Click is mainnet only and answers a testnet refundTo with 400 "Internal server error". Dry quotes never take
      // funds, so any mainnet account prices correctly.
      pricingRefundTo: process.env.ONECLICK_PRICING_REFUND_TO ?? "intents.near",
      pricingRecipient: process.env.ONECLICK_PRICING_RECIPIENT ?? "0x0000000000000000000000000000000000000001",
    })
  : undefined;

const ok = { result: "ok" } as const;
const redis = process.env.REDIS_URL ? connectRedis(process.env.REDIS_URL) : undefined;
const probes: Probe[] = [
  // The time to get back onto the event loop is the latency, so a blocked process reads as degraded.
  { id: "api", name: "API", kind: "service", run: () => new Promise<typeof ok>((resolve) => setImmediate(() => resolve(ok))) },
  { id: "database", name: "Database", kind: "service", run: async () => (await unit((tx) => tx.$queryRaw`SELECT 1`), ok) },
  ...(redis ? [{ id: "redis", name: "Redis", kind: "service" as const, run: async () => ((await withReconnect(redis, () => redis.ping())) === "PONG" ? ok : { result: "down" as const }) }] : []),
  ...(oneClick ? [{ id: "near_intents", name: "NEAR Intents", kind: "service" as const, run: async () => ((await oneClick.tokens()).length > 0 ? ok : { result: "down" as const }) }] : []),
  ...(mockVault ? [] : [{ id: "vault", name: "Vault", kind: "service" as const, run: async () => (await vault.getBalance(registrationAccount), ok) }]),
  // Only configured providers: the sandbox provider always reports healthy, which says nothing.
  ...configured.map((adapter) => ({
    id: adapter.id,
    name: adapter.id.charAt(0).toUpperCase() + adapter.id.slice(1),
    kind: "provider" as const,
    run: async () => ((await adapter.health()).healthy ? ok : { result: "down" as const }),
  })),
];

const solanaRpc = createSolanaRpc({ url: process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", commitment: "confirmed", timeoutMs: 3_000 });
const deposits = createDeposits({
  client: oneClick,
  vaultAccount: config.vaultAccount,
  usdcContract,
  slippageBps: Number(process.env.ONECLICK_DEPOSIT_SLIPPAGE_BPS ?? 200),
  arrivals: { solana: ({ address, mint, since }) => latestSolanaArrival(solanaRpc, address, mint, since) },
  // The MockVault stands in for the chain, so it is handed the ft_transfer_call 1Click makes to the real vault.
  ...(mockVault
    ? {
        onLanded: ({ account, units, message }: { account: string; units: bigint; message: string }) => {
          const returned = mockVault.ftOnTransfer({ predecessor: usdcContract, senderId: "intents.near", amount: units, msg: message });
          if (returned > 0n) console.error("[deposits] vault refused a top-up", account);
        },
      }
    : {}),
});

const quoteDeps = { adapters, ...(hops ? { hop: hops } : {}), routing: DEFAULT_ROUTING_CONFIG, signals: NO_SIGNALS, now: () => new Date() };
const rateBoard = createRateBoard(quoteDeps, unit);

// With a relayer, claiming a name creates the user's NEAR account on chain; without one, nothing is created on chain.
const relayerUrl = process.env.RELAYER_URL?.trim();
const relayerToken = process.env.RELAYER_AUTH_TOKEN?.trim();
if (relayerUrl && !relayerToken) console.warn("RELAYER_URL is set without RELAYER_AUTH_TOKEN: names are claimed without NEAR accounts.");
const relayer = relayerUrl && relayerToken ? createRelayerClient({ url: relayerUrl, authToken: relayerToken }) : undefined;
// On Render's free plan a service sleeps after 15 minutes without requests and takes about a minute to wake, longer
// than a name claim waits. Pinging it while the API is up keeps it awake.
const RELAYER_KEEPALIVE_MS = 10 * 60 * 1000;
if (relayer) {
  const ping = () => relayer.health().catch((error: Error) => console.warn(`relayer health check failed: ${error.message}`));
  void ping();
  setInterval(ping, RELAYER_KEEPALIVE_MS).unref();
}
const provisioner = relayer
  ? new RelayerProvisioner(relayer, config.vaultAccount)
  : new MockProvisioner(config.vaultAccount, mockVault ? (account) => mockVault.registerStorage(account) : undefined);

const payoutWatch = { unit, adapters, ...(oneClick ? { oneClick } : {}), now: () => new Date(), log: (message: string) => app.log.warn(message) };
const handlers = createHandlers({
  refreshPayout: payoutRefresher(payoutWatch),
  config,
  unit,
  email: createEmailSender(config),
  provisioner,
  ...(relayer ? { relayer } : {}),
  vault,
  status: { probes },
  deposits,
  rateBoard,
  quotes: quoteDeps,
  payouts: {
    config,
    adapters,
    velocity: DEFAULT_VELOCITY,
    now: () => new Date(),
    ...(hops ? { intents: { hops, vault, tokenStorage, guardBps: DEFAULT_GUARD_BPS, deadlineMarginMs: Number(process.env.ONECLICK_DEADLINE_MARGIN_MS ?? DEFAULT_DEADLINE_MARGIN_MS) } } : {}),
  },
});

const app = buildApp({ config, unit, handlers, logger: true, limiter: createLimiter(process.env.REDIS_URL),
  webhooks: createWebhookHandler({ unit, adapters, dataKey: config.dataKey }),
  recordUsage: usageRecorder(unit, (message) => console.error(message)) });
await app.listen({ port: config.port, host: "0.0.0.0" });
startHealthChecks(unit, probes, Number(process.env.HEALTH_CHECK_INTERVAL_MS ?? 60_000));
startRateSampler(rateBoard, Number(process.env.RATE_SAMPLE_INTERVAL_MS ?? 60_000));
startDepositWatch(unit, deposits, Number(process.env.DEPOSIT_WATCH_INTERVAL_MS ?? 10_000));
startPayoutWatch(payoutWatch, Number(process.env.PAYOUT_WATCH_INTERVAL_MS ?? 20_000));
startVaultSync(
  { unit, vault, now: () => new Date(), log: (message) => app.log.warn(message) },
  Number(process.env.VAULT_SYNC_INTERVAL_MS ?? 15_000),
);
const apns = apnsFromEnv(process.env);
startPushDispatch(
  { unit, send: apns ? createApnsSender(apns) : null, dataKey: config.dataKey, now: () => new Date(), log: (message) => app.log.warn(message) },
  Number(process.env.PUSH_INTERVAL_MS ?? 3_000),
);
startWebhookDelivery(
  { unit, config, transport: httpsTransport(), now: () => new Date() },
  Number(process.env.WEBHOOK_POLL_INTERVAL_MS ?? 2_000),
  (message) => app.log.error(message),
);
