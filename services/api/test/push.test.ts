import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encrypt } from "../packages/db/src/crypto.js";
import {
  apnsFromEnv,
  apnsJwt,
  apnsPayload,
  depositMessage,
  dispatchPushes,
  dollars,
  handle,
  isDeadToken,
  payoutMessage,
  transferInMessage,
  transferOutMessage,
  type PushTarget,
} from "../apps/api/src/push.js";
import { registerDevice, removeDevice } from "../apps/api/src/settings.js";
import type { Db, Unit } from "../apps/api/src/db.js";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const credentials = { keyId: "ABC123DEFG", teamId: "YCKKUWB4WD", key: pem };

describe("APNs token", () => {
  it("is an ES256 JWT naming the key and team that Apple can verify", () => {
    const jwt = apnsJwt(credentials, 1_794_484_000);
    const [header, claims, signature] = jwt.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "ES256",
      kid: "ABC123DEFG",
    });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({
      iss: "YCKKUWB4WD",
      iat: 1_794_484_000,
    });
    const valid = verify(
      "sha256",
      Buffer.from(`${header}.${claims}`),
      { key: createPublicKey(privateKey), dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    );
    expect(valid).toBe(true);
  });

  it("reads the .p8 from the environment with literal \\n, and is off when a value is missing", () => {
    expect(apnsFromEnv({ APNS_KEY_ID: "k", APNS_TEAM_ID: "t", APNS_KEY: "a\\nb" })).toEqual({
      keyId: "k",
      teamId: "t",
      key: "a\nb",
    });
    expect(apnsFromEnv({ APNS_KEY_ID: "k", APNS_TEAM_ID: "t" })).toBeNull();
  });
});

describe("push messages", () => {
  it("has the alert, the sound and what the app opens", () => {
    expect(
      apnsPayload({ title: "You received $5.00", body: "From @frank", kind: "transfer_in", refId: "tr_1" }),
    ).toEqual({
      aps: { alert: { title: "You received $5.00", body: "From @frank" }, sound: "default" },
      kind: "transfer_in",
      ref_id: "tr_1",
    });
  });

  it("says who in fliq names and how much in dollars", () => {
    expect(dollars(1_025_133n)).toBe("$1.03");
    expect(dollars(10_000_000n)).toBe("$10.00");
    expect(handle("sejiro.fliqaccount.near")).toBe("@sejiro");
    expect(handle("someone.near")).toBe("someone.near");
    expect(transferInMessage("u2", "tr_1", 5_000_000n, "frank.fliqaccount.near")).toMatchObject({
      userId: "u2",
      title: "You received $5.00",
      body: "From @frank",
    });
    expect(transferOutMessage("u1", "tr_1", 5_000_000n, "ada.fliqaccount.near")).toMatchObject({
      userId: "u1",
      title: "Sent $5.00 to @ada",
      body: "It's in their vault now.",
    });
    expect(transferOutMessage("u1", "tr_2", 5_000_000n, "frank.near", true)).toMatchObject({
      title: "Sent $5.00 to frank.near",
      body: "It's in their wallet now.",
    });
    expect(depositMessage("u1", "dep_1", 9_990_000n, "usdc", "solana")).toMatchObject({
      title: "$9.99 arrived in your vault",
      body: "USDC from Solana",
    });
  });

  it("names the bank payout by its outcome", () => {
    const payout = {
      id: "po_1",
      amountIn: 10_070_000n,
      amountOutMinor: 1_388_200n,
      currency: "ngn",
      agentName: null,
    };
    expect(payoutMessage("u1", { ...payout, state: "settled" }, "Frank Opia")).toMatchObject({
      title: "₦13,882 paid to Frank Opia",
      setting: "payout_paid",
    });
    expect(payoutMessage("u1", { ...payout, state: "refunded" }, "Frank Opia")?.title).toBe(
      "Cash out refunded: $10.07 is back in your vault",
    );
    expect(payoutMessage("u1", { ...payout, state: "failed" }, "Frank Opia")?.title).toBe(
      "Cash out didn't go through",
    );
    expect(payoutMessage("u1", { ...payout, state: "paying_out" }, "Frank Opia")).toBeNull();
  });

  it("drops a token Apple says is gone", () => {
    expect(isDeadToken({ status: 410, reason: "Unregistered" })).toBe(true);
    expect(isDeadToken({ status: 400, reason: "BadDeviceToken" })).toBe(true);
    expect(isDeadToken({ status: 429, reason: "TooManyRequests" })).toBe(false);
  });
});

describe("devices", () => {
  it("registers a token in lowercase with its gateway and app, moving it to the latest user", async () => {
    const calls: unknown[] = [];
    const tx = {
      pushToken: {
        upsert: async (args: unknown) => void calls.push(args),
        deleteMany: async (args: unknown) => void calls.push(args),
      },
    } as unknown as Db;
    await registerDevice(tx, "u2", {
      token: "ABCDEF0123",
      platform: "ios",
      environment: "production",
      bundle_id: "cash.fliq.app.mainnet",
    });
    await removeDevice(tx, "u2", "ABCDEF0123");
    expect(calls[0]).toMatchObject({
      where: { token: "abcdef0123" },
      create: {
        token: "abcdef0123",
        userId: "u2",
        environment: "production",
        bundleId: "cash.fliq.app.mainnet",
      },
      update: { userId: "u2", environment: "production", bundleId: "cash.fliq.app.mainnet" },
    });
    expect(calls[1]).toEqual({ where: { token: "abcdef0123", userId: "u2" } });
  });
});

describe("dispatch", () => {
  const dataKey = Buffer.alloc(32, 7);
  const now = new Date("2026-11-12T12:00:00Z");

  function world() {
    const inbox = new Set<string>();
    const tokens: (PushTarget & { userId: string; platform: string })[] = [
      {
        token: "aa",
        userId: "u2",
        platform: "ios",
        environment: "production",
        bundleId: "cash.fliq.app.mainnet",
      },
      {
        token: "bb",
        userId: "u1",
        platform: "ios",
        environment: "production",
        bundleId: "cash.fliq.app.mainnet",
      },
    ];
    const tx = {
      inbox: {
        findMany: async ({ where }: { where: { messageId: { in: string[] } } }) =>
          where.messageId.in.filter((id) => inbox.has(id)).map((messageId) => ({ messageId })),
        createMany: async ({ data }: { data: { messageId: string }[] }) => {
          const id = (data[0] as { messageId: string }).messageId;
          if (inbox.has(id)) return { count: 0 };
          inbox.add(id);
          return { count: 1 };
        },
      },
      transfer: {
        findMany: async () => [
          {
            id: "tr_1",
            fromUserId: "u1",
            toUserId: "u2",
            fromAccount: "frank.fliqaccount.near",
            toAccount: "ada.fliqaccount.near",
            amount: 5_000_000n,
          },
        ],
      },
      vaultDeposit: { findMany: async () => [] },
      payoutEvent: { findMany: async () => [{ id: "pev_1", payoutId: "po_1", toState: "settled" }] },
      payout: {
        findUnique: async () => ({
          id: "po_1",
          agentId: null,
          amountIn: 10_070_000n,
          amountOutMinor: 1_388_200n,
          currency: "ngn",
          recipient: { userId: "u1", nameCipher: encrypt("Frank Opia", dataKey) },
        }),
      },
      agent: { findUnique: async () => null },
      user: {
        findUnique: async ({ where }: { where: { id: string } }) => ({
          notificationSettings: where.id === "u1" ? { payout_paid: false } : null,
        }),
      },
      pushToken: {
        findMany: async ({ where }: { where: { userId: string } }) =>
          tokens.filter((token) => token.userId === where.userId),
        deleteMany: async ({ where }: { where: { token: string } }) =>
          void tokens.splice(
            tokens.findIndex((token) => token.token === where.token),
            1,
          ),
      },
    };
    const unit = (async (body: (tx: Db) => Promise<unknown>) => body(tx as unknown as Db)) as unknown as Unit;
    return { unit, tokens };
  }

  it("sends each event once, respects the user's settings and forgets dead tokens", async () => {
    const { unit, tokens } = world();
    const sent: { token: string; payload: object }[] = [];
    const send = async (target: PushTarget, payload: object) => {
      sent.push({ token: target.token, payload });
      return target.token === "bb" ? { status: 410, reason: "Unregistered" } : { status: 200 };
    };
    const deps = { unit, send, dataKey, now: () => now, log: () => {} };

    expect(await dispatchPushes(deps)).toBe(1);
    expect(await dispatchPushes(deps)).toBe(0);

    expect(sent.map((item) => item.token)).toEqual(["aa", "bb"]);
    expect(sent[0]?.payload).toMatchObject({
      kind: "transfer_in",
      ref_id: "tr_1",
      aps: { alert: { title: "You received $5.00", body: "From @frank" } },
    });
    expect(sent[1]?.payload).toMatchObject({
      kind: "transfer_out",
      aps: { alert: { title: "Sent $5.00 to @ada" } },
    });
    expect(tokens.map((token) => token.token)).toEqual(["aa"]);
  });

  it("claims nothing while APNs is not configured, so turning it on later still sends", async () => {
    const { unit } = world();
    expect(await dispatchPushes({ unit, send: null, dataKey, now: () => now, log: () => {} })).toBe(0);
  });
});
