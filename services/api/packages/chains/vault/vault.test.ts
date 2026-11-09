import { describe, expect, it } from "vitest";
import {
  canSetStatus,
  formatVaultEvent,
  parseVaultEvents,
  RECEIPT_STATUSES,
  topUpMessage,
  VaultError,
  VaultEventError,
  type VaultEvent,
} from "./index";

const wire = (event: string, data: unknown, version = "1.0.0") =>
  `EVENT_JSON:${JSON.stringify({ standard: "fliq_vault", version, event, data: [data] })}`;

const registered = {
  order_id: "po_01JBX4Q8Z2",
  payer: "ada.testnet",
  deposit_address: "0x76b4c56085ed136a8744d52be956396624a730e8",
  amount: "50000000",
  expires_at_ns: "1762200000000000000",
  corridor: "NG-NGN-bank",
};

describe("parseVaultEvents", () => {
  it("parses the agreed wire format into typed values", () => {
    expect(parseVaultEvents(wire("order_registered", registered))).toEqual([
      {
        event: "order_registered",
        orderId: "po_01JBX4Q8Z2",
        payer: "ada.testnet",
        depositAddress: "0x76b4c56085ed136a8744d52be956396624a730e8",
        amount: 50_000_000n,
        expiresAtNs: 1_762_200_000_000_000_000n,
        corridor: "NG-NGN-bank",
      },
    ]);
  });

  it("maps receipt references to camel case", () => {
    const log = wire("status_set", {
      order_id: "po_1",
      status: "settled",
      refs: { provider: "paycrest", bank_reference: "000013251029140213" },
    });
    expect(parseVaultEvents(log)).toEqual([
      {
        event: "status_set",
        orderId: "po_1",
        status: "settled",
        refs: { provider: "paycrest", bankReference: "000013251029140213" },
      },
    ]);
  });

  it("ignores logs that are not fliq_vault events", () => {
    expect(parseVaultEvents("Transfer 5 from a.near to b.near")).toBeNull();
    const usdc = `EVENT_JSON:${JSON.stringify({ standard: "nep141", version: "1.0.0", event: "ft_transfer", data: [] })}`;
    expect(parseVaultEvents(usdc)).toBeNull();
  });

  it.each([
    [
      "an unsupported version",
      wire("recredited", { order_id: "po_1", payer: "a.testnet", amount: "1" }, "2.0.0"),
    ],
    ["an unknown event", wire("order_deleted", { order_id: "po_1" })],
    ["a negative amount", wire("recredited", { order_id: "po_1", payer: "a.testnet", amount: "-1" })],
    ["a numeric amount", wire("recredited", { order_id: "po_1", payer: "a.testnet", amount: 1 })],
    [
      "an amount above u128",
      wire("recredited", { order_id: "po_1", payer: "a.testnet", amount: (2n ** 128n).toString() }),
    ],
    ["a missing field", wire("order_released", { order_id: "po_1", amount: "1" })],
    [
      "an unexpected field",
      wire("order_released", { order_id: "po_1", payer: "a.testnet", amount: "1", memo: "x" }),
    ],
    ["an unknown status", wire("status_set", { order_id: "po_1", status: "paid", refs: {} })],
    [
      "a personal-data ref",
      wire("status_set", { order_id: "po_1", status: "settled", refs: { account_name: "x" } }),
    ],
    ["invalid JSON", "EVENT_JSON:{not json"],
  ])("rejects %s", (_, log) => {
    expect(() => parseVaultEvents(log)).toThrow(VaultEventError);
  });

  it("round-trips every event through the formatter", () => {
    const events: VaultEvent[] = [
      {
        event: "order_registered",
        orderId: "po_1",
        payer: "ada.testnet",
        depositAddress: "0xabc",
        amount: 1n,
        expiresAtNs: 2n,
        corridor: "KE-KES-mobile_money",
      },
      {
        event: "payout_executed",
        orderId: "po_1",
        payer: "ada.testnet",
        depositAddress: "0xabc",
        amount: 1n,
        publicKey: "ed25519:11111111111111111111111111111111",
      },
      { event: "order_released", orderId: "po_1", payer: "ada.testnet", amount: 1n },
      { event: "status_set", orderId: "po_1", status: "refunded", refs: { refundTx: "0xdef" } },
      { event: "recredited", orderId: "po_1", payer: "ada.testnet", amount: 1n },
      { event: "deposited", accountId: "ada.testnet", senderId: "intents.near", amount: 2n ** 128n - 1n },
      {
        event: "agent_set",
        owner: "ada.testnet",
        publicKey: "ed25519:11111111111111111111111111111111",
        agentId: "agent-1.ada.testnet",
        perPayoutCap: 1n,
        dailyCap: 2n,
        corridors: ["NG-NGN-bank"],
        cooldownNs: 0n,
        expiryNs: 3_600_000_000_000n,
      },
      { event: "agent_revoked", owner: "ada.testnet", agentId: "agent-1.ada.testnet", publicKey: "ed25519:11111111111111111111111111111111" },
      { event: "agent_spend", owner: "ada.testnet", agentId: "agent-1.ada.testnet", orderId: "po_1", amount: 1n },
      { event: "transferred", from: "ada.testnet", to: "bo.testnet", amount: 1n },
    ];
    for (const event of events) expect(parseVaultEvents(formatVaultEvent(event))).toEqual([event]);
  });
});

describe("receipt status transitions", () => {
  it("allows any non-terminal status straight after execution, but never refunded", () => {
    expect(canSetStatus(null, "routing")).toBe(true);
    expect(canSetStatus(null, "settled")).toBe(true);
    expect(canSetStatus(null, "refunded")).toBe(false);
  });

  it("only moves forward", () => {
    expect(canSetStatus("paying_out", "settled")).toBe(true);
    expect(canSetStatus("paying_out", "routing")).toBe(false);
    expect(canSetStatus("refunding", "refunded")).toBe(false);
    expect(canSetStatus("refunding", "failed")).toBe(true);
    expect(canSetStatus("refunding", "settled")).toBe(false);
  });

  it("treats settled, refunded and failed as terminal", () => {
    for (const terminal of ["settled", "refunded", "failed"] as const) {
      expect(RECEIPT_STATUSES.filter((next) => canSetStatus(terminal, next))).toEqual([]);
    }
  });
});

describe("VaultError.fromPanic", () => {
  it("maps a contract panic message to its code", () => {
    const message = "Smart contract panicked: fliq_vault: RECREDIT_EXCEEDS_ORDER";
    expect(VaultError.fromPanic(message)?.code).toBe("RECREDIT_EXCEEDS_ORDER");
  });

  it("returns null for panics that are not ours or not known", () => {
    expect(VaultError.fromPanic("Smart contract panicked: Exceeded the prepaid gas")).toBeNull();
    expect(VaultError.fromPanic("fliq_vault: SOMETHING_NEW")).toBeNull();
  });
});

describe("topUpMessage", () => {
  it("builds the proposed ft_transfer_call message", () => {
    expect(JSON.parse(topUpMessage("ada.testnet"))).toEqual({ top_up: { account_id: "ada.testnet" } });
  });
});

describe("the vault's review-fix events", () => {
  const line = (event: string, data: Record<string, unknown>) =>
    `EVENT_JSON:${JSON.stringify({ standard: "fliq_vault", version: "1.0.0", event, data: [data] })}`;

  it.each([
    ["withdrawn", { account_id: "ada.testnet", amount: "5" }],
    ["withdraw_failed", { account_id: "ada.testnet", amount: "5" }],
    ["payout_failed", { order_id: "po_1", payer: "ada.testnet", amount: "5" }],
    ["payout_resolved", { order_id: "po_1", transferred: false, resolved_by: "owner.testnet" }],
    ["payout_timeout_set", { payout_timeout: "600000000000" }],
    ["agent_spend_reversed", { owner: "ada.testnet", agent_id: "agent-1.ada.testnet", order_id: "po_1", amount: "5" }],
  ])("reads %s", (event, data) => {
    expect(parseVaultEvents(line(event, data))?.[0]?.event).toBe(event);
  });

  it("refuses a resolution whose transferred flag is not a boolean", () => {
    expect(() =>
      parseVaultEvents(line("payout_resolved", { order_id: "po_1", transferred: "no", resolved_by: "owner.testnet" })),
    ).toThrow();
  });
});
