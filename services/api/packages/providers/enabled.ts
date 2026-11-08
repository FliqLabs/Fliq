import { createBitnobAdapter } from "./bitnob/bitnob";
import { createBushaAdapter } from "./busha/busha";
import { createFonbnkAdapter } from "./fonbnk/fonbnk";
import { withInstitutionCodes } from "./institutions/translate";
import { createPaycrestAdapter } from "./paycrest/paycrest";
import { createTransfiAdapter } from "./transfi/transfi";
import type { AdapterDeps, ProviderAdapter } from "./types";

export type Env = Readonly<Record<string, string | undefined>>;

type Environment = "sandbox" | "production";

function value(env: Env, name: string): string | undefined {
  const raw = env[name]?.trim();
  return raw ? raw : undefined;
}

// A provider is on when any of its variables is set. Then every required one must be, so a typo
// fails the boot instead of silently dropping a provider from routing.
function section(env: Env, provider: string, required: readonly string[], optional: readonly string[] = []) {
  const names = [...required, ...optional];
  if (!names.some((name) => value(env, name))) return null;
  const missing = required.filter((name) => !value(env, name));
  if (missing.length > 0) throw new Error(`${provider} is partly configured: set ${missing.join(", ")}`);
  return (name: string) => value(env, name) ?? "";
}

function environment(provider: string, raw: string): Environment {
  if (raw === "sandbox" || raw === "production") return raw;
  throw new Error(`${provider} environment must be "sandbox" or "production"`);
}

// The previous secret stays accepted during a rotation (ARCH §9.4: 24 h overlap).
function webhookSecrets(env: Env, name: string): string[] {
  return [value(env, name), value(env, `${name}_PREVIOUS`)].filter(
    (secret): secret is string => secret !== undefined,
  );
}

export function enabledAdapters(env: Env, deps: AdapterDeps): ProviderAdapter[] {
  const adapters: ProviderAdapter[] = [];

  const paycrest = section(env, "Paycrest", ["PAYCREST_API_KEY", "PAYCREST_API_SECRET"]);
  if (paycrest) {
    adapters.push(
      createPaycrestAdapter({
        apiKey: paycrest("PAYCREST_API_KEY"),
        webhookSecrets: webhookSecrets(env, "PAYCREST_API_SECRET"),
        deps,
      }),
    );
  }

  const bitnob = section(
    env,
    "Bitnob",
    ["BITNOB_CLIENT_ID", "BITNOB_CLIENT_SECRET", "BITNOB_ENVIRONMENT", "BITNOB_WEBHOOK_SECRET"],
    ["BITNOB_CALLBACK_URL"],
  );
  if (bitnob) {
    const callbackUrl = bitnob("BITNOB_CALLBACK_URL");
    adapters.push(
      createBitnobAdapter({
        clientId: bitnob("BITNOB_CLIENT_ID"),
        clientSecret: bitnob("BITNOB_CLIENT_SECRET"),
        expectedEnvironment: environment("Bitnob", bitnob("BITNOB_ENVIRONMENT")),
        webhookSecrets: webhookSecrets(env, "BITNOB_WEBHOOK_SECRET"),
        ...(callbackUrl ? { callbackUrl } : {}),
        deps,
      }),
    );
  }

  const busha = section(env, "Busha", ["BUSHA_SECRET_KEY", "BUSHA_ENVIRONMENT", "BUSHA_WEBHOOK_SECRET"]);
  if (busha) {
    adapters.push(
      createBushaAdapter({
        secretKey: busha("BUSHA_SECRET_KEY"),
        environment: environment("Busha", busha("BUSHA_ENVIRONMENT")),
        webhookSecrets: webhookSecrets(env, "BUSHA_WEBHOOK_SECRET"),
        deps,
      }),
    );
  }

  const fonbnk = section(
    env,
    "Fonbnk",
    [
      "FONBNK_CLIENT_ID",
      "FONBNK_SIGNATURE_SECRET",
      "FONBNK_ENVIRONMENT",
      "FONBNK_WEBHOOK_SECRET",
      "FONBNK_USER_EMAIL",
      "FONBNK_USER_IP",
    ],
    ["FONBNK_WEBHOOK_URL"],
  );
  if (fonbnk) {
    const webhookUrl = fonbnk("FONBNK_WEBHOOK_URL");
    adapters.push(
      createFonbnkAdapter({
        clientId: fonbnk("FONBNK_CLIENT_ID"),
        signatureSecret: fonbnk("FONBNK_SIGNATURE_SECRET"),
        environment: environment("Fonbnk", fonbnk("FONBNK_ENVIRONMENT")),
        webhookSecrets: webhookSecrets(env, "FONBNK_WEBHOOK_SECRET"),
        endUser: { email: fonbnk("FONBNK_USER_EMAIL"), ip: fonbnk("FONBNK_USER_IP") },
        ...(webhookUrl ? { webhookUrl } : {}),
        deps,
      }),
    );
  }

  const transfi = section(env, "TransFi", [
    "TRANSFI_USERNAME",
    "TRANSFI_PASSWORD",
    "TRANSFI_MID",
    "TRANSFI_ENVIRONMENT",
    "TRANSFI_WEBHOOK_SECRET",
    "TRANSFI_SENDER_USER_ID",
    "TRANSFI_SENDER_IP",
  ]);
  if (transfi) {
    adapters.push(
      createTransfiAdapter({
        username: transfi("TRANSFI_USERNAME"),
        password: transfi("TRANSFI_PASSWORD"),
        mid: transfi("TRANSFI_MID"),
        environment: environment("TransFi", transfi("TRANSFI_ENVIRONMENT")),
        webhookSecrets: webhookSecrets(env, "TRANSFI_WEBHOOK_SECRET"),
        sender: { userId: transfi("TRANSFI_SENDER_USER_ID"), ip: transfi("TRANSFI_SENDER_IP") },
        deps,
      }),
    );
  }

  return adapters.map((adapter) => withInstitutionCodes(adapter));
}
