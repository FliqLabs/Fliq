import { describe, expect, it } from "vitest";
import { hmac } from "../webhooks/hmac";
import { enabledAdapters, type Env } from "./enabled";
import { WEBHOOK_SETTLED_V2 } from "./paycrest/paycrest.fixtures";
import { PAYCREST_SIGNATURE_HEADER } from "./paycrest/paycrest";
import { TRANSFI_SIGNATURE_HEADER } from "./transfi/transfi";
import { WEBHOOK_FUND_SETTLED } from "./transfi/transfi.fixtures";

const deps = { alert: () => undefined };

const PAYCREST: Env = { PAYCREST_API_KEY: "pk", PAYCREST_API_SECRET: "current" };
const BITNOB: Env = {
  BITNOB_CLIENT_ID: "id",
  BITNOB_CLIENT_SECRET: "secret",
  BITNOB_ENVIRONMENT: "sandbox",
  BITNOB_WEBHOOK_SECRET: "whsec",
};
const BUSHA: Env = { BUSHA_SECRET_KEY: "sk", BUSHA_ENVIRONMENT: "production", BUSHA_WEBHOOK_SECRET: "whsec" };
const FONBNK: Env = {
  FONBNK_CLIENT_ID: "client",
  FONBNK_SIGNATURE_SECRET: "c2VjcmV0",
  FONBNK_ENVIRONMENT: "sandbox",
  FONBNK_WEBHOOK_SECRET: "whsec",
  FONBNK_USER_EMAIL: "payouts@fliq.example",
  FONBNK_USER_IP: "203.0.113.10",
};

const TRANSFI: Env = {
  TRANSFI_USERNAME: "user",
  TRANSFI_PASSWORD: "password",
  TRANSFI_MID: "SABCDEF_SCT8YW_NA",
  TRANSFI_ENVIRONMENT: "sandbox",
  TRANSFI_WEBHOOK_SECRET: "current",
  TRANSFI_SENDER_USER_ID: "UX-250930062608488",
  TRANSFI_SENDER_IP: "203.0.113.10",
};

const ids = (env: Env) => enabledAdapters(env, deps).map((adapter) => adapter.id);

describe("enabled adapters", () => {
  it("enables nothing when no provider is configured", () => {
    expect(ids({})).toEqual([]);
    expect(ids({ PAYCREST_API_KEY: "  " })).toEqual([]);
  });

  it("enables exactly the providers whose variables are set", () => {
    expect(ids(PAYCREST)).toEqual(["paycrest"]);
    expect(ids({ ...BITNOB, ...BUSHA })).toEqual(["bitnob", "busha"]);
    expect(ids({ ...PAYCREST, ...BITNOB, ...BUSHA })).toEqual(["paycrest", "bitnob", "busha"]);
    expect(ids(FONBNK)).toEqual(["fonbnk"]);
    expect(() => ids({ ...FONBNK, FONBNK_USER_IP: "" })).toThrow(
      "Fonbnk is partly configured: set FONBNK_USER_IP",
    );
    expect(ids(TRANSFI)).toEqual(["transfi"]);
    expect(() => ids({ ...TRANSFI, TRANSFI_SENDER_USER_ID: " " })).toThrow(
      "TransFi is partly configured: set TRANSFI_SENDER_USER_ID",
    );
  });

  it("refuses a partly configured provider and names what is missing", () => {
    expect(() => ids({ PAYCREST_API_KEY: "pk" })).toThrow(
      "Paycrest is partly configured: set PAYCREST_API_SECRET",
    );
    expect(() => ids({ BITNOB_CALLBACK_URL: "https://api.example/hooks/bitnob" })).toThrow(
      "set BITNOB_CLIENT_ID, BITNOB_CLIENT_SECRET, BITNOB_ENVIRONMENT, BITNOB_WEBHOOK_SECRET",
    );
  });

  it("refuses an unknown environment", () => {
    expect(() => ids({ ...BUSHA, BUSHA_ENVIRONMENT: "live" })).toThrow(
      'Busha environment must be "sandbox" or "production"',
    );
    expect(() => ids({ ...TRANSFI, TRANSFI_ENVIRONMENT: "live" })).toThrow(
      'TransFi environment must be "sandbox" or "production"',
    );
  });

  it("accepts the current and the previous webhook secret", () => {
    const [paycrest] = enabledAdapters({ ...PAYCREST, PAYCREST_API_SECRET_PREVIOUS: "previous" }, deps);
    const rawBody = JSON.stringify(WEBHOOK_SETTLED_V2);
    for (const secret of ["current", "previous"]) {
      const headers = { [PAYCREST_SIGNATURE_HEADER]: hmac("sha256", secret, rawBody, "hex") };
      expect(paycrest?.parseWebhook({ headers, rawBody }).order.status).toBe("paid");
    }
  });

  it("accepts the current and the previous TransFi webhook secret", () => {
    const [transfi] = enabledAdapters({ ...TRANSFI, TRANSFI_WEBHOOK_SECRET_PREVIOUS: "previous" }, deps);
    const rawBody = JSON.stringify(WEBHOOK_FUND_SETTLED);
    for (const secret of ["current", "previous"]) {
      const headers = { [TRANSFI_SIGNATURE_HEADER]: hmac("sha256", secret, rawBody, "hex") };
      expect(transfi?.parseWebhook({ headers, rawBody }).order.status).toBe("paid");
    }
  });
});
