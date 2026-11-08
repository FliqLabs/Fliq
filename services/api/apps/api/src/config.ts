import { parseKey } from "../../../packages/db/src/crypto.js";

export interface Config {
  port: number;
  accessSecret: string;
  dataKey: Buffer;
  hashKey: Buffer;
  rpId: string;
  rpName: string;
  origins: string[];
  nearRootAccount: string;
  vaultAccount: string;
  // The USDC contract the vault accepts, so a top-up the user relays from their own account can be recognised.
  usdcContract: string;
  emailLinkBaseUrl: string;
  emailFrom: string;
  resendApiKey: string | undefined;
  payLinkBase: string;
  // Decision 12: sandbox and production are separate deployments, so each issues and accepts one key environment.
  keyEnvironment: "test" | "live";
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 4000),
    accessSecret: required(env, "FLIQ_ACCESS_SECRET"),
    dataKey: parseKey(required(env, "FLIQ_DATA_KEY")),
    hashKey: parseKey(required(env, "FLIQ_HASH_KEY")),
    rpId: env.WEBAUTHN_RP_ID ?? "localhost",
    rpName: "fliq",
    origins: (env.WEBAUTHN_ORIGINS ?? "http://localhost:3000").split(",").map((origin) => origin.trim()).filter(Boolean),
    nearRootAccount: env.NEAR_ROOT_ACCOUNT ?? "fliq.near",
    vaultAccount: env.VAULT_ACCOUNT ?? "fliq-vault.testnet",
    usdcContract: env.USDC_CONTRACT_ID ?? "usdc.test.near",
    emailLinkBaseUrl: env.EMAIL_LINK_BASE_URL ?? "http://localhost:3000",
    emailFrom: env.EMAIL_FROM ?? "FLIQ <noreply@fliq.cash>",
    resendApiKey: env.RESEND_API_KEY || undefined,
    payLinkBase: (env.PAY_LINK_BASE_URL ?? "https://pay.fliq.money").replace(/\/+$/, ""),
    keyEnvironment: env.FLIQ_ENV === "production" ? "live" : "test",
  };
}
