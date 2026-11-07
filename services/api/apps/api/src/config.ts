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
  emailLinkBaseUrl: string;
  emailFrom: string;
  resendApiKey: string | undefined;
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
    origins: (env.WEBAUTHN_ORIGINS ?? "http://localhost:3000").split(","),
    nearRootAccount: env.NEAR_ROOT_ACCOUNT ?? "fliq.near",
    vaultAccount: env.VAULT_ACCOUNT ?? "fliq-vault.testnet",
    emailLinkBaseUrl: env.EMAIL_LINK_BASE_URL ?? "http://localhost:3000",
    emailFrom: env.EMAIL_FROM ?? "FLIQ <noreply@fliq.cash>",
    resendApiKey: env.RESEND_API_KEY || undefined,
    keyEnvironment: env.FLIQ_ENV === "production" ? "live" : "test",
  };
}
