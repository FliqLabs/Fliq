import { readFileSync } from "node:fs";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import {
  accountCreator,
  amqp,
  chainRpc,
  ConfigError,
  database,
  listVariables,
  loadConfig,
  loadConfigOrExit,
  near,
  oneClick,
  redis,
  relayer,
  relayerClient,
  vaultRegistration,
  type Env,
} from "./index";

const all = {
  database,
  redis,
  amqp,
  chainRpc,
  near,
  vaultRegistration,
  oneClick,
  relayer,
  relayerClient,
  accountCreator,
};

const key = (char: string) => `ed25519:${char.repeat(88)}`;
const token = (char: string) => char.repeat(32);
const RPC_WITH_KEY = "https://base.example.com/v2/rpc-path-credential";

const sandbox: Env = {
  FLIQ_ENV: "sandbox",
  DATABASE_URL: "postgresql://db.internal:5432/fliq",
  REDIS_URL: "redis://redis.internal:6379",
  AMQP_URL: "amqps://mq.example.com:5671",
  BASE_RPC_URL: RPC_WITH_KEY,
  POLYGON_RPC_URL: "https://polygon.example.com",
  SOLANA_RPC_URL: "https://solana.example.com",
  NEAR_NETWORK: "testnet",
  NEAR_RPC_URL: "https://rpc.testnet.example.com",
  VAULT_CONTRACT_ID: "vault.fliq.testnet",
  USDC_CONTRACT_ID: "usdc.fakes.testnet",
  NEAR_REGISTRATION_ACCOUNT_ID: "registrar.fliq.testnet",
  NEAR_REGISTRATION_PRIVATE_KEY: key("2"),
  ONECLICK_URL: "https://oneclick.example.com",
  ONECLICK_FEE_RECIPIENT: "fees.fliq.near",
  ONECLICK_APP_FEE_BPS: "30",
  RELAYER_URL: "http://relayer.railway.internal:8080",
  RELAYER_ACCOUNT_ID: "relayer.fliq.testnet",
  RELAYER_PRIVATE_KEYS: ["3", "4", "5", "6", "7"].map(key).join(","),
  RELAYER_AUTH_TOKEN: token("a"),
  RELAYER_PORT: "4200",
  NEAR_ROOT_ACCOUNT: "fliq.testnet",
  NEAR_ROOT_PRIVATE_KEY: key("8"),
  NEAR_ACCOUNT_FUNDING_YOCTO: "0",
};

const production: Env = {
  ...sandbox,
  FLIQ_ENV: "production",
  NEAR_NETWORK: "mainnet",
  VAULT_CONTRACT_ID: "vault.fliq.near",
  USDC_CONTRACT_ID: "usdc.fliq.near",
  NEAR_REGISTRATION_ACCOUNT_ID: "registrar.fliq.near",
  RELAYER_ACCOUNT_ID: "relayer.fliq.near",
  NEAR_ROOT_ACCOUNT: "fliq.near",
  ONECLICK_API_KEY: token("k"),
};

const local: Env = {
  ...sandbox,
  FLIQ_ENV: "local",
  NEAR_NETWORK: "sandbox",
  AMQP_URL: "amqp://localhost:5672",
  RELAYER_PRIVATE_KEYS: key("3"),
};

function problems(env: Env): Record<string, string> {
  try {
    loadConfig(all, env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    return Object.fromEntries(error.issues.map((issue) => [issue.variable, issue.problem]));
  }
  return {};
}

describe("loadConfig", () => {
  it("loads a complete sandbox environment into typed values", () => {
    const config = loadConfig(all, sandbox);
    expect(config.deployment).toBe("sandbox");
    expect(config.near.network).toBe("testnet");
    expect(config.oneClick.appFeeBps).toBe(30);
    expect(config.oneClick.apiKey).toBeUndefined();
    expect(config.relayer.privateKeys).toHaveLength(5);
    expect(config.chainRpc.base.reveal()).toBe(RPC_WITH_KEY);
  });

  it("reports every missing variable in one error", () => {
    const found = problems({ FLIQ_ENV: "sandbox" });
    expect(Object.keys(found)).toEqual(
      expect.arrayContaining([
        "DATABASE_URL",
        "AMQP_URL",
        "NEAR_REGISTRATION_PRIVATE_KEY",
        "RELAYER_AUTH_TOKEN",
      ]),
    );
    expect(new Set(Object.values(found))).toEqual(new Set(["missing"]));
  });

  it("never guesses the deployment and applies production rules without it", () => {
    const found = problems({ ...sandbox, FLIQ_ENV: undefined });
    expect(found.FLIQ_ENV).toBe("missing");
    expect(found.NEAR_NETWORK).toBe("testnet is not allowed when FLIQ_ENV is production");
    expect(found.ONECLICK_API_KEY).toBe("required in production");
  });

  it("rejects malformed values by name", () => {
    const found = problems({
      ...sandbox,
      DATABASE_URL: "mysql://db.internal/fliq",
      ONECLICK_URL: "not a url",
      ONECLICK_APP_FEE_BPS: "2.5",
      VAULT_CONTRACT_ID: "Vault!",
      NEAR_REGISTRATION_PRIVATE_KEY: "secp256k1:abc",
    });
    expect(found).toEqual({
      DATABASE_URL: "must be a URL starting with postgres:// or postgresql://",
      ONECLICK_URL: "must be a URL starting with https:// or http://",
      ONECLICK_APP_FEE_BPS: "must be a whole number from 0 to 1000",
      VAULT_CONTRACT_ID: "must be a valid NEAR account id",
      NEAR_REGISTRATION_PRIVATE_KEY: "must be an ed25519:<base58> key",
    });
  });

  it("caps the app fee", () => {
    expect(problems({ ...sandbox, ONECLICK_APP_FEE_BPS: "1001" })).toHaveProperty("ONECLICK_APP_FEE_BPS");
  });
});

describe("network rules", () => {
  it("accepts a complete production environment", () => {
    expect(loadConfig(all, production).near.network).toBe("mainnet");
  });

  it("refuses testnet in production and mainnet in sandbox", () => {
    expect(problems({ ...production, NEAR_NETWORK: "testnet" })).toHaveProperty("NEAR_NETWORK");
    expect(problems({ ...sandbox, NEAR_NETWORK: "mainnet" })).toHaveProperty("NEAR_NETWORK");
  });

  it("refuses accounts from the other network", () => {
    expect(problems({ ...production, VAULT_CONTRACT_ID: "vault.fliq.testnet" })).toEqual({
      VAULT_CONTRACT_ID: "is a testnet account on mainnet",
    });
    expect(problems({ ...sandbox, RELAYER_ACCOUNT_ID: "relayer.fliq.near" })).toEqual({
      RELAYER_ACCOUNT_ID: "is a mainnet account on testnet",
    });
  });

  it("requires a TLS broker outside local", () => {
    expect(problems({ ...sandbox, AMQP_URL: "amqp://mq.example.com:5672" })).toEqual({
      AMQP_URL: "must be a URL starting with amqps://",
    });
    expect(loadConfig(all, local).amqp.url.reveal()).toBe("amqp://localhost:5672");
  });

  it("requires https RPC and the 1Click key in production", () => {
    const found = problems({ ...production, BASE_RPC_URL: "http://base.example.com", ONECLICK_API_KEY: "" });
    expect(found).toEqual({
      BASE_RPC_URL: "must be a URL starting with https://",
      ONECLICK_API_KEY: "required in production",
    });
  });

  it("needs a pool of 5 to 10 relayer keys outside local", () => {
    expect(problems({ ...sandbox, RELAYER_PRIVATE_KEYS: key("3") })).toEqual({
      RELAYER_PRIVATE_KEYS: "must hold 5 to 10 keys",
    });
    expect(loadConfig(all, local).relayer.privateKeys).toHaveLength(1);
  });
});

describe("account creator", () => {
  it("reads the root account, its key and a yocto funding amount beyond the safe integer range", () => {
    const config = loadConfig(all, { ...sandbox, NEAR_ACCOUNT_FUNDING_YOCTO: "10000000000000000000000" });
    expect(config.accountCreator.rootAccountId).toBe("fliq.testnet");
    expect(config.accountCreator.fundingYocto).toBe(10n ** 22n);
    expect(String(config.accountCreator.rootPrivateKey)).toBe("[redacted]");
  });

  it("caps funding at 0.1 NEAR and keeps the root on the configured network", () => {
    expect(problems({ ...sandbox, NEAR_ACCOUNT_FUNDING_YOCTO: "100000000000000000000001" })).toEqual({
      NEAR_ACCOUNT_FUNDING_YOCTO: "must be a whole number from 0 to 100000000000000000000000",
    });
    expect(problems({ ...sandbox, NEAR_ROOT_ACCOUNT: "fliq.near" })).toEqual({
      NEAR_ROOT_ACCOUNT: "is a mainnet account on testnet",
    });
  });
});

describe("secret rotation", () => {
  it("accepts the current and previous secret and nothing else", () => {
    const config = loadConfig(all, { ...sandbox, RELAYER_AUTH_TOKEN_PREVIOUS: token("b") });
    expect(config.relayer.authToken.accepts(token("a"))).toBe(true);
    expect(config.relayer.authToken.accepts(token("b"))).toBe(true);
    expect(config.relayer.authToken.accepts(token("c"))).toBe(false);
  });

  it("refuses a previous secret equal to the current one", () => {
    expect(problems({ ...sandbox, RELAYER_AUTH_TOKEN_PREVIOUS: token("a") })).toEqual({
      RELAYER_AUTH_TOKEN_PREVIOUS: "must differ from RELAYER_AUTH_TOKEN",
    });
  });

  it("refuses short secrets", () => {
    expect(problems({ ...sandbox, RELAYER_AUTH_TOKEN: "short" })).toEqual({
      RELAYER_AUTH_TOKEN: "must be at least 16 characters",
    });
  });
});

describe("redaction", () => {
  it("never puts a value in an error message", () => {
    const marker = "LEAKMARKER";
    try {
      loadConfig(all, {
        ...sandbox,
        DATABASE_URL: `mysql://${marker}@db.internal/fliq`,
        RELAYER_AUTH_TOKEN: marker,
        NEAR_REGISTRATION_PRIVATE_KEY: `ed25519:${marker}`,
        RELAYER_PRIVATE_KEYS: `${key("3")},${marker}`,
      });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain(marker);
    }
  });

  it("keeps secrets out of logged or serialised config", () => {
    const config = loadConfig(all, sandbox);
    const renderings = [
      JSON.stringify(config, (_, value: unknown) => (typeof value === "bigint" ? value.toString() : value)),
      inspect(config, { depth: 10 }),
      `${config.database.url}`,
    ];
    for (const text of renderings) {
      for (const secret of [key("2"), key("3"), token("a"), RPC_WITH_KEY, sandbox.DATABASE_URL ?? ""]) {
        expect(text).not.toContain(secret);
      }
    }
  });
});

describe("loadConfigOrExit", () => {
  it("logs the named problems and exits with code 1", () => {
    const logged: string[] = [];
    const exit = (code: number): never => {
      throw new Error(`exit ${code}`);
    };
    expect(() =>
      loadConfigOrExit(all, { FLIQ_ENV: "sandbox" }, { exit, log: (line) => logged.push(line) }),
    ).toThrow("exit 1");
    expect(logged.join("\n")).toContain("DATABASE_URL: missing");
  });
});

describe(".env.example", () => {
  it("lists every variable the config reads", () => {
    const example = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
    const listed = new Set([...example.matchAll(/^([A-Z0-9_]+)=/gm)].map((match) => match[1]));
    expect(listVariables(all).filter((name) => !listed.has(name))).toEqual([]);
  });
});
