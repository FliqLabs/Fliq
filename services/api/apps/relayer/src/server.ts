import { Redis } from "ioredis";
import { accountCreator, loadConfigOrExit, near, redis, relayer } from "../../../packages/config/index.js";
import { createNearRpc, RedisRelayStore } from "../../../packages/chains/near/index.js";
import { buildRelayerApp } from "./app.js";

const config = loadConfigOrExit({ redis, near, relayer, accountCreator });
const rpc = createNearRpc({ url: config.near.rpcUrl.reveal() });
const store = new RedisRelayStore(new Redis(config.redis.url.reveal(), { maxRetriesPerRequest: 2 }));

const app = buildRelayerApp({
  logger: true,
  authToken: config.relayer.authToken,
  relay: {
    rpc,
    store,
    policy: { vaultContractId: config.near.vaultContractId, usdcContractId: config.near.usdcContractId },
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
