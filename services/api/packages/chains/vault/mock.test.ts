import { beforeEach, describe, expect, it } from "vitest";
import {
  MockVault,
  parseVaultEvents,
  topUpMessage,
  type RegisterOrderInput,
  type VaultErrorCode,
} from "./index";

const REGISTRAR = "registrar.fliq.testnet";
const USDC = "usdc.fakes.testnet";
const ADA = "ada.testnet";
const AGENT = "agent-1.ada.testnet";
const SECOND_NS = 1_000_000_000n;
const DAY_NS = 86_400n * SECOND_NS;
const USDC_UNIT = 1_000_000n;

let now: bigint;
let vault: MockVault;

const order = (overrides: Partial<RegisterOrderInput> = {}): RegisterOrderInput => ({
  orderId: "po_1",
  payer: ADA,
  depositAddress: "0x76b4c56085ed136a8744d52be956396624a730e8",
  amount: 50n * USDC_UNIT,
  expiresAtNs: now + 600n * SECOND_NS,
  corridor: "NG-NGN-bank",
  ...overrides,
});

const deposit = (accountId: string, amount: bigint) =>
  vault.ftOnTransfer({ predecessor: USDC, senderId: accountId, amount, msg: "" });

async function refusal(action: Promise<unknown> | (() => unknown)): Promise<VaultErrorCode | undefined> {
  try {
    await (typeof action === "function" ? action() : action);
  } catch (error) {
    return (error as { code?: VaultErrorCode }).code;
  }
  return undefined;
}

async function executedOrder(): Promise<void> {
  await vault.registerOrder(order());
  vault.payout(ADA, "po_1");
}

beforeEach(() => {
  now = 1_762_200_000n * SECOND_NS;
  vault = new MockVault({ registrar: REGISTRAR, usdc: USDC, now: () => now });
  vault.registerStorage(ADA);
  deposit(ADA, 200n * USDC_UNIT);
});

describe("register_order", () => {
  it("reserves the amount and emits order_registered", async () => {
    await vault.registerOrder(order());
    expect(await vault.getBalance(ADA)).toEqual({
      available: 150n * USDC_UNIT,
      reserved: 50n * USDC_UNIT,
      total: 200n * USDC_UNIT,
    });
    expect((await vault.getReceipt("po_1"))?.state).toBe("registered");
    expect(vault.events.at(-1)?.event).toBe("order_registered");
  });

  it.each<[string, () => Promise<unknown>, VaultErrorCode]>([
    ["a caller other than the registrar", () => vault.as(ADA).registerOrder(order()), "UNAUTHORIZED"],
    ["a zero amount", () => vault.registerOrder(order({ amount: 0n })), "INVALID_AMOUNT"],
    [
      "more than the available balance",
      () => vault.registerOrder(order({ amount: 201n * USDC_UNIT })),
      "INSUFFICIENT_BALANCE",
    ],
    ["an expiry in the past", () => vault.registerOrder(order({ expiresAtNs: now })), "INVALID_EXPIRY"],
    [
      "an expiry more than 24 hours ahead",
      () => vault.registerOrder(order({ expiresAtNs: now + DAY_NS + SECOND_NS })),
      "INVALID_EXPIRY",
    ],
  ])("refuses %s", async (_, action, code) => {
    expect(await refusal(action)).toBe(code);
  });

  it("refuses a duplicate order id", async () => {
    await vault.registerOrder(order());
    expect(await refusal(vault.registerOrder(order()))).toBe("ORDER_EXISTS");
  });
});

describe("payout", () => {
  it("sends the reserved funds out once", async () => {
    await executedOrder();
    expect(await vault.getBalance(ADA)).toEqual({
      available: 150n * USDC_UNIT,
      reserved: 0n,
      total: 150n * USDC_UNIT,
    });
    expect(await refusal(() => vault.payout(ADA, "po_1"))).toBe("ORDER_NOT_REGISTERED");
  });

  it("only lets the payer release funds", async () => {
    await vault.registerOrder(order());
    expect(await refusal(() => vault.payout(REGISTRAR, "po_1"))).toBe("UNAUTHORIZED");
  });

  it("refuses an expired order, which the payer can then release", async () => {
    await vault.registerOrder(order());
    expect(await refusal(vault.as(ADA).releaseOrder("po_1"))).toBe("ORDER_NOT_EXPIRED");
    now += 600n * SECOND_NS;
    expect(await refusal(() => vault.payout(ADA, "po_1"))).toBe("ORDER_EXPIRED");
    await vault.as(ADA).releaseOrder("po_1");
    expect(await vault.getBalance(ADA)).toMatchObject({ available: 200n * USDC_UNIT, reserved: 0n });
  });

  it("lets the registrar release before expiry but not after execution", async () => {
    await vault.registerOrder(order());
    expect(await refusal(vault.as("mallory.testnet").releaseOrder("po_1"))).toBe("UNAUTHORIZED");
    await vault.releaseOrder("po_1");
    expect(await refusal(vault.releaseOrder("po_1"))).toBe("ORDER_NOT_REGISTERED");
  });
});

describe("agent policy", () => {
  beforeEach(() => {
    vault.setAgent(ADA, AGENT, {
      perPayoutCap: 60n * USDC_UNIT,
      dailyCap: 80n * USDC_UNIT,
      corridors: ["NG-NGN-bank"],
    });
  });

  const agentPays = (orderId: string) => () => vault.payout(AGENT, orderId);
  const agentOrder = (overrides: Partial<RegisterOrderInput>) => order({ agentId: AGENT, ...overrides });

  it("lets an agent pay only orders registered for it", async () => {
    await vault.registerOrder(order({ orderId: "po_mine", amount: USDC_UNIT }));
    expect(await refusal(agentPays("po_mine"))).toBe("AGENT_NOT_BOUND");
    await vault.registerOrder(agentOrder({ orderId: "po_agent", amount: USDC_UNIT }));
    agentPays("po_agent")();
  });

  it("enforces the per-payout cap, daily cap and corridor list of the agent account", async () => {
    await vault.registerOrder(agentOrder({ orderId: "po_big", amount: 61n * USDC_UNIT }));
    await vault.registerOrder(
      agentOrder({ orderId: "po_ke", corridor: "KE-KES-mobile_money", amount: USDC_UNIT }),
    );
    await vault.registerOrder(agentOrder({ orderId: "po_a", amount: 50n * USDC_UNIT }));
    await vault.registerOrder(agentOrder({ orderId: "po_b", amount: 31n * USDC_UNIT }));

    expect(await refusal(agentPays("po_big"))).toBe("POLICY_PER_PAYOUT_CAP");
    expect(await refusal(agentPays("po_ke"))).toBe("POLICY_CORRIDOR");
    agentPays("po_a")();
    expect(await refusal(agentPays("po_b"))).toBe("POLICY_DAILY_CAP");
    expect((await vault.getAgent(ADA, AGENT))?.spentToday).toBe(50n * USDC_UNIT);
  });

  it("resets the daily allowance the next day and leaves the payer unlimited", async () => {
    await vault.registerOrder(agentOrder({ orderId: "po_a", amount: 60n * USDC_UNIT }));
    agentPays("po_a")();
    now += DAY_NS;
    expect((await vault.getAgent(ADA, AGENT))?.spentToday).toBe(0n);
    await vault.registerOrder(agentOrder({ orderId: "po_big", amount: 100n * USDC_UNIT }));
    vault.payout(ADA, "po_big");
  });

  it("refuses an agent of another payer and an account that is no agent", async () => {
    vault.setAgent("bob.testnet", "agent-1.bob.testnet", {
      perPayoutCap: USDC_UNIT,
      dailyCap: USDC_UNIT,
      corridors: null,
    });
    await vault.registerOrder(order({ amount: USDC_UNIT }));
    expect(await refusal(() => vault.payout("agent-1.bob.testnet", "po_1"))).toBe("UNAUTHORIZED");
    expect(await refusal(() => vault.payout("mallory.testnet", "po_1"))).toBe("UNAUTHORIZED");
  });

  it("stops an agent at once when the payer removes it, and keeps it to one owner", async () => {
    expect(
      await refusal(() =>
        vault.setAgent("bob.testnet", AGENT, {
          perPayoutCap: USDC_UNIT,
          dailyCap: USDC_UNIT,
          corridors: null,
        }),
      ),
    ).toBe("AGENT_TAKEN");
    expect(await refusal(() => vault.removeAgent("bob.testnet", AGENT))).toBe("AGENT_NOT_FOUND");
    vault.removeAgent(ADA, AGENT);
    await vault.registerOrder(order({ amount: USDC_UNIT }));
    expect(await refusal(agentPays("po_1"))).toBe("UNAUTHORIZED");
    expect(await vault.getAgent(ADA, AGENT)).toBeNull();
  });
});

describe("set_status", () => {
  it("refuses a status before execution, a backward move and any move after a terminal status", async () => {
    await vault.registerOrder(order());
    expect(await refusal(vault.setStatus("po_1", "routing", {}))).toBe("INVALID_TRANSITION");
    vault.payout(ADA, "po_1");
    await vault.setStatus("po_1", "paying_out", { provider: "paycrest" });
    expect(await refusal(vault.setStatus("po_1", "routing", {}))).toBe("INVALID_TRANSITION");
    await vault.setStatus("po_1", "settled", { bankReference: "000013251029140213" });
    expect(await refusal(vault.setStatus("po_1", "failed", {}))).toBe("INVALID_TRANSITION");
    expect((await vault.getReceipt("po_1"))?.refs).toEqual({
      provider: "paycrest",
      bankReference: "000013251029140213",
    });
  });

  it("never writes refunded, and never changes a reference once set", async () => {
    await executedOrder();
    await vault.setStatus("po_1", "refunding", { refundTx: "4Fx9refund" });
    expect(await refusal(vault.setStatus("po_1", "refunded", {}))).toBe("INVALID_TRANSITION");
    expect(await refusal(vault.setStatus("po_1", "failed", { refundTx: "other" }))).toBe("REF_IMMUTABLE");
    expect(await refusal(vault.setStatus("po_1", "failed", { bankReference: "x".repeat(129) }))).toBe(
      "INVALID_REF",
    );
    await vault.setStatus("po_1", "failed", { refundTx: "4Fx9refund" });
  });

  it("is refused for anyone but the registrar", async () => {
    await executedOrder();
    expect(await refusal(vault.as(ADA).setStatus("po_1", "settled", {}))).toBe("UNAUTHORIZED");
  });
});

describe("recredit", () => {
  beforeEach(async () => {
    await executedOrder();
    await vault.setStatus("po_1", "refunding", {});
  });

  it("credits a confirmed refund from the unattributed balance once", async () => {
    vault.receivePlainTransfer(50n * USDC_UNIT);
    expect(vault.unattributed()).toBe(50n * USDC_UNIT);
    await vault.recredit("po_1", 50n * USDC_UNIT);
    expect(await vault.getBalance(ADA)).toMatchObject({ available: 200n * USDC_UNIT });
    expect((await vault.getReceipt("po_1"))?.status).toBe("refunded");
    expect(vault.unattributed()).toBe(0n);
    vault.receivePlainTransfer(50n * USDC_UNIT);
    expect(await refusal(vault.recredit("po_1", USDC_UNIT))).toBe("ALREADY_RECREDITED");
  });

  it("refuses more than the order amount or the unattributed balance", async () => {
    vault.receivePlainTransfer(80n * USDC_UNIT);
    expect(await refusal(vault.recredit("po_1", 51n * USDC_UNIT))).toBe("RECREDIT_EXCEEDS_ORDER");
    expect(await refusal(vault.recredit("po_1", 0n))).toBe("INVALID_AMOUNT");
    await vault.registerOrder(order({ orderId: "po_2", amount: 100n * USDC_UNIT }));
    vault.payout(ADA, "po_2");
    await vault.setStatus("po_2", "refunding", {});
    expect(await refusal(vault.recredit("po_2", 100n * USDC_UNIT))).toBe("RECREDIT_EXCEEDS_UNATTRIBUTED");
  });

  it("refuses a settled order and any caller but the registrar", async () => {
    vault.receivePlainTransfer(50n * USDC_UNIT);
    expect(await refusal(vault.as(ADA).recredit("po_1", USDC_UNIT))).toBe("UNAUTHORIZED");
    await vault.registerOrder(order({ orderId: "po_2" }));
    vault.payout(ADA, "po_2");
    await vault.setStatus("po_2", "settled", {});
    expect(await refusal(vault.recredit("po_2", USDC_UNIT))).toBe("NOT_REFUNDABLE");
  });
});

describe("top-up attribution", () => {
  const BOB = "bob.testnet";
  const intents = (msg: string, amount = 10n * USDC_UNIT) =>
    vault.ftOnTransfer({ predecessor: USDC, senderId: "intents.near", amount, msg });

  it("credits the account named in a top_up message, not the sender", async () => {
    vault.registerStorage(BOB);
    expect(intents(topUpMessage(BOB))).toBe(0n);
    expect(await vault.getBalance(BOB)).toMatchObject({ available: 10n * USDC_UNIT });
    expect(await vault.getBalance("intents.near")).toMatchObject({ available: 0n });
    expect(vault.events.at(-1)).toEqual({
      event: "deposited",
      accountId: BOB,
      senderId: "intents.near",
      amount: 10n * USDC_UNIT,
    });
  });

  it("returns the amount for an unregistered beneficiary, an unknown message or another token", () => {
    expect(intents(topUpMessage(BOB))).toBe(10n * USDC_UNIT);
    expect(intents('{"top_up":{"account_id":"ada.testnet","extra":1}}')).toBe(10n * USDC_UNIT);
    expect(intents("ada.testnet")).toBe(10n * USDC_UNIT);
    expect(vault.ftOnTransfer({ predecessor: "fake-usdc.testnet", senderId: ADA, amount: 1n, msg: "" })).toBe(
      1n,
    );
    expect(vault.unattributed()).toBe(0n);
  });
});

describe("events", () => {
  it("emits logs in the frozen wire format", async () => {
    await executedOrder();
    vault.setAgent(ADA, AGENT, { perPayoutCap: USDC_UNIT, dailyCap: USDC_UNIT, corridors: null });
    vault.removeAgent(ADA, AGENT);
    const parsed = vault.logs().flatMap((log) => parseVaultEvents(log) ?? []);
    expect(parsed.map((event) => event.event)).toEqual([
      "deposited",
      "order_registered",
      "payout_executed",
      "agent_set",
      "agent_revoked",
    ]);
    expect(parsed).toEqual(vault.events);
  });
});
