import { defineSection } from "./load";
import type { Deployment, Reader } from "./reader";
import { Secret } from "./secret";

const NEAR_NETWORKS = ["sandbox", "testnet", "mainnet"] as const;
export type NearNetwork = (typeof NEAR_NETWORKS)[number];

const ALLOWED_NEAR_NETWORKS: Record<Deployment, readonly NearNetwork[]> = {
  local: ["sandbox", "testnet"],
  sandbox: ["testnet"],
  production: ["mainnet"],
};

const MAX_APP_FEE_BPS = 1_000;

function publicUrlSchemes(read: Reader): string[] {
  return read.deployment === "production" ? ["https:"] : ["https:", "http:"];
}

function nearNetwork(read: Reader): NearNetwork {
  const network = read.oneOf("NEAR_NETWORK", NEAR_NETWORKS);
  if (!ALLOWED_NEAR_NETWORKS[read.deployment].includes(network)) {
    read.fail("NEAR_NETWORK", `${network} is not allowed when FLIQ_ENV is ${read.deployment}`);
  }
  return network;
}

// Named accounts carry their network in the suffix; implicit (hex) accounts and the local sandbox do not.
function nearAccountOn(read: Reader, name: string, network: NearNetwork): string {
  const account = read.nearAccount(name);
  if (read.hasProblem("NEAR_NETWORK") || read.hasProblem(name)) return account;
  if (network === "mainnet" && account.endsWith(".testnet"))
    read.fail(name, "is a testnet account on mainnet");
  if (network === "testnet" && account.endsWith(".near")) read.fail(name, "is a mainnet account on testnet");
  return account;
}

export const database = defineSection((read) => ({
  url: new Secret(read.url("DATABASE_URL", ["postgres:", "postgresql:"])),
}));

export const redis = defineSection((read) => ({
  url: new Secret(read.url("REDIS_URL", ["redis:", "rediss:"])),
}));

export const amqp = defineSection((read) => ({
  url: new Secret(read.url("AMQP_URL", read.deployment === "local" ? ["amqp:", "amqps:"] : ["amqps:"])),
}));

export const chainRpc = defineSection((read) => ({
  base: new Secret(read.url("BASE_RPC_URL", publicUrlSchemes(read))),
  polygon: new Secret(read.url("POLYGON_RPC_URL", publicUrlSchemes(read))),
  solana: new Secret(read.url("SOLANA_RPC_URL", publicUrlSchemes(read))),
}));

export const near = defineSection((read) => {
  const network = nearNetwork(read);
  return {
    network,
    rpcUrl: new Secret(read.url("NEAR_RPC_URL", publicUrlSchemes(read))),
    vaultContractId: nearAccountOn(read, "VAULT_CONTRACT_ID", network),
    usdcContractId: nearAccountOn(read, "USDC_CONTRACT_ID", network),
  };
});

export const vaultRegistration = defineSection((read) => {
  const network = nearNetwork(read);
  return {
    accountId: nearAccountOn(read, "NEAR_REGISTRATION_ACCOUNT_ID", network),
    privateKey: read.nearKey("NEAR_REGISTRATION_PRIVATE_KEY"),
  };
});

export const oneClick = defineSection((read) => {
  const apiKey = read.optional("ONECLICK_API_KEY", (name) => read.secret(name));
  if (read.deployment === "production" && !apiKey) read.fail("ONECLICK_API_KEY", "required in production");
  return {
    url: read.url("ONECLICK_URL", publicUrlSchemes(read)),
    apiKey,
    feeRecipient: read.nearAccount("ONECLICK_FEE_RECIPIENT"),
    appFeeBps: read.int("ONECLICK_APP_FEE_BPS", 0, MAX_APP_FEE_BPS),
  };
});

export const relayer = defineSection((read) => {
  const network = nearNetwork(read);
  const minKeys = read.deployment === "local" ? 1 : 5;
  return {
    accountId: nearAccountOn(read, "RELAYER_ACCOUNT_ID", network),
    privateKeys: read.nearKeys("RELAYER_PRIVATE_KEYS", minKeys, 10),
    authToken: read.rotatingSecret("RELAYER_AUTH_TOKEN"),
  };
});

export const relayerClient = defineSection((read) => ({
  url: read.url("RELAYER_URL", ["http:", "https:"]),
  authToken: read.secret("RELAYER_AUTH_TOKEN"),
}));
