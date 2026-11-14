import { describe, expect, it } from "vitest";
import { createAlerts } from "../apps/api/src/alerts.js";
import { ApiError } from "../apps/api/src/errors.js";
import { createOps, opsConfigFromEnv } from "../apps/api/src/ops.js";

describe("operator pauses", () => {
  it("pauses only what FLIQ_PAUSED names", () => {
    const ops = createOps(opsConfigFromEnv({ FLIQ_PAUSED: " Payouts , nonsense" }));
    expect(() => ops.assertRunning("payouts")).toThrowError(ApiError);
    expect(() => ops.assertRunning("deposits")).not.toThrow();
  });

  it("pauses nothing and caps nothing by default", async () => {
    const ops = createOps({ ...opsConfigFromEnv({}), liabilities: async () => 10n ** 15n });
    expect(() => ops.assertRunning("payouts")).not.toThrow();
    await expect(ops.assertRoomInVault()).resolves.toBeUndefined();
  });

  it("answers a pause with 503 and words a user can read", () => {
    const ops = createOps(opsConfigFromEnv({ FLIQ_PAUSED: "payouts" }));
    try {
      ops.assertRunning("payouts");
      expect.unreachable();
    } catch (error) {
      expect((error as ApiError).status).toBe(503);
      expect((error as ApiError).code).toBe("paused");
      expect((error as ApiError).message).toContain("Your money is safe");
    }
  });
});

describe("the vault cap", () => {
  const capped = (held: bigint | Error, log: string[] = []) =>
    createOps({
      ...opsConfigFromEnv({ FLIQ_VAULT_CAP_USDC: "25000" }),
      liabilities: async () => {
        if (held instanceof Error) throw held;
        return held;
      },
      log: (message) => void log.push(message),
    });

  it("lets deposits in below the cap and refuses them at it", async () => {
    await expect(capped(24_999_999_999n).assertRoomInVault()).resolves.toBeUndefined();
    await expect(capped(25_000_000_000n).assertRoomInVault()).rejects.toMatchObject({ status: 503, code: "paused" });
  });

  it("does not block deposits when the chain cannot be read, and says so", async () => {
    const log: string[] = [];
    await expect(capped(new TypeError("down"), log).assertRoomInVault()).resolves.toBeUndefined();
    expect(log.join()).toContain("unreadable");
  });

  it("refuses a cap that is not a whole number of dollars", () => {
    expect(() => opsConfigFromEnv({ FLIQ_VAULT_CAP_USDC: "25k" })).toThrow();
  });
});

describe("alerts", () => {
  const setup = (config: { botToken: string; chatId: string } | null = { botToken: "t", chatId: "c" }) => {
    const sent: string[] = [];
    const logged: string[] = [];
    let at = 0;
    const alert = createAlerts({
      config,
      log: (message) => void logged.push(message),
      now: () => at,
      send: async (_config, text) => void sent.push(text),
    });
    return { alert, sent, logged, advance: (ms: number) => (at += ms) };
  };

  it("logs every line and sends nothing without a bot", () => {
    const { alert, sent, logged } = setup(null);
    alert("stuck");
    expect(logged).toEqual(["stuck"]);
    expect(sent).toEqual([]);
  });

  it("does not repeat the same line for half an hour", () => {
    const { alert, sent, logged, advance } = setup();
    alert("po_1 held 5 min");
    advance(20_000);
    alert("po_1 held 5 min");
    expect(sent).toHaveLength(1);
    expect(logged).toHaveLength(2);
    advance(30 * 60_000);
    alert("po_1 held 5 min");
    expect(sent).toHaveLength(2);
  });

  it("caps a burst at twenty a minute", () => {
    const { alert, sent, advance } = setup();
    for (let index = 0; index < 50; index++) alert(`line ${index}`);
    expect(sent).toHaveLength(20);
    advance(60_000);
    alert("after the minute");
    expect(sent).toHaveLength(21);
  });

  it("never throws when the send fails", async () => {
    const logged: string[] = [];
    const alert = createAlerts({
      config: { botToken: "t", chatId: "c" },
      log: (message) => void logged.push(message),
      send: async () => {
        throw new TypeError("network");
      },
    });
    expect(() => alert("stuck")).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(logged.join()).toContain("not delivered");
  });
});
