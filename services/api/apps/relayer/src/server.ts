// Must stay first: Sentry instruments fastify and http only if it is initialised before they load.
import "../../../packages/observability/instrument-relayer.js";
import { Redis } from "ioredis";
import { accountCreator, loadConfigOrExit, near, redis, relayer } from "../../../packages/config/index.js";
import { createNearRpc, RedisRelayStore } from "../../../packages/chains/near/index.js";
import { buildRelayerApp } from "./app.js";

const config = loadConfigOrExit({ redis, near, relayer, accountCreator });
const rpcUrl = config.near.rpcUrl.reveal();
// The relayer sends each delegate once; a rate-limited endpoint (429) never took it, so the next one is tried.
const fallbackUrls = process.env.NEAR_RPC_FALLBACK_URLS?.trim()
  ? process.env.NEAR_RPC_FALLBACK_URLS.split(",").map((url) => url.trim()).filter(Boolean)
  : rpcUrl.includes("mainnet")
    ? ["https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org"]
    : [];
const rpc = createNearRpc({ url: rpcUrl, fallbackUrls });
const store = new RedisRelayStore(new Redis(config.redis.url.reveal(), { maxRetriesPerRequest: 2 }));

const app = buildRelayerApp({
  logger: true,
  authToken: config.relayer.authToken,
  relay: {
    rpc,
    store,
    policy: {
      vaultContractId: config.near.vaultContractId,
      usdcContractId: config.near.usdcContractId,
      intentsContractId: config.near.intentsContractId,
    },
    relayerAccountId: config.relayer.accountId,
    relayerKeys: config.relayer.privateKeys.map((key) => key.reveal()),
    now: Date.now,
  },
  provision: {
    rpc,
    store,
    root: {
      accountId: config.accountCreator.rootAccountId,
      privateKey: config.accountCreator.rootPrivateKey.reveal(),
    },
    fundingYocto: config.accountCreator.fundingYocto,
    storageContracts: [config.near.usdcContractId, config.near.vaultContractId],
  },
});

// "::" listens on IPv6, which Railway's private network uses; the service has no public domain.
await app.listen({ port: config.relayer.port, host: "::" });
