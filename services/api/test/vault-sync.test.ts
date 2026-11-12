import { describe, expect, it } from "vitest";
import { MockVault, VaultError, type VaultClient, type VaultReceipt } from "../packages/chains/vault/index.js";
import { planVaultSync, syncVaultReceipts, type SyncedPayout } from "../apps/api/src/vault-sync.js";
import type { Unit } from "../apps/api/src/db.js";

const NOW_NS = 1_000_000_000_000n;
const PAYER = "ada.testnet";
const REGISTRAR = "registrar.test.near";

const payout = (state: SyncedPayout["state"], over: Partial<SyncedPayout> = {}): SyncedPayout => ({
  id: "po_1",
  state,
  provider: "paycrest",
  providerOrderId: "pc_order_1",
  ...over,
});

const receipt = (over: Partial<VaultReceipt> = {}): VaultReceipt => ({
  orderId: "po_1",
  payer: PAYER,
  depositAddress: "dep.testnet",
  amount: 5_000_000n,
  expiresAtNs: NOW_NS + 1n,
  corridor: "NG-NGN-bank",
  state: "executed",
  transferState: "dispatched",
  status: null,
  refs: {},
  recreditedAmount: 0n,
  ...over,
});

describe("planVaultSync", () => {
  it("does nothing for an order the vault never registered", () => {
    expect(planVaultSync(payout("routing"), null)).toEqual({ kind: "none", reason: "no_receipt" });
  });

  it("releases the reservation when the payout ended before the payer paid", () => {
    const registered = receipt({ state: "registered", transferState: "registered" });
    expect(planVaultSync(payout("expired"), registered)).toEqual({ kind: "release" });
    expect(planVaultSync(payout("failed"), registered)).toEqual({ kind: "release" });
    expect(planVaultSync(payout("awaiting_deposit"), registered).kind).toBe("none");
  });

  it("mirrors the backend status with the provider references", () => {
    expect(planVaultSync(payout("routing"), receipt())).toEqual({
      kind: "set_status",
      status: "routing",
      refs: { provider: "paycrest", providerOrder: "pc_order_1" },
    });
  });

  it("waits for the transfer to be dispatched before paying_out or settled", () => {
    const executing = receipt({ transferState: "executing" });
    expect(planVaultSync(payout("paying_out"), executing)).toEqual({ kind: "none", reason: "transfer_not_dispatched" });
    expect(planVaultSync(payout("with_provider"), executing).kind).toBe("set_status");
  });

  it("never resends a reference the receipt already holds, and is idempotent once in sync", () => {
    const synced = receipt({ status: "settled", refs: { provider: "paycrest", providerOrder: "pc_order_1" } });
    expect(planVaultSync(payout("settled"), synced)).toEqual({ kind: "none", reason: "in_sync" });
    const otherRef = receipt({ status: "with_provider", refs: { provider: "busha" } });
    expect(planVaultSync(payout("paying_out"), otherRef)).toEqual({
      kind: "set_status",
      status: "paying_out",
      refs: { providerOrder: "pc_order_1" },
    });
  });

  it("leaves refunded to recredit and ignores states the receipt does not mirror", () => {
    expect(planVaultSync(payout("refunded"), receipt({ status: "refunding" })).kind).toBe("none");
    expect(planVaultSync(payout("deposit_seen"), receipt()).kind).toBe("none");
    expect(planVaultSync(payout("released" as never), receipt({ state: "released" })).kind).toBe("none");
  });

  it("drops a reference the contract would refuse", () => {
    const plan = planVaultSync(payout("routing", { providerOrderId: "has space" }), receipt());
    expect(plan).toEqual({ kind: "set_status", status: "routing", refs: { provider: "paycrest" } });
  });
});

describe("syncVaultReceipts", () => {
  const setup = async () => {
    const vault = new MockVault({ registrar: REGISTRAR, usdc: "usdc.test.near", now: () => NOW_NS });
    vault.registerStorage(PAYER);
    vault.ftOnTransfer({ predecessor: "usdc.test.near", senderId: PAYER, amount: 20_000_000n, msg: "" });
    for (const id of ["po_paid", "po_unpaid"]) {
      await vault.registerOrder({ orderId: id, payer: PAYER, depositAddress: "dep.testnet", amount: 5_000_000n, expiresAtNs: NOW_NS + 600_000_000_000n, corridor: "NG-NGN-bank" });
    }
    vault.payout(PAYER, "po_paid");
    const rows = [payout("with_provider", { id: "po_paid" }), payout("expired", { id: "po_unpaid" }), payout("routing", { id: "po_missing" })];
    const unit = (async (fn: (tx: unknown) => unknown) =>
      fn({ payout: { findMany: async () => rows }, journalEntry: { findUnique: async () => null } })) as unknown as Unit;
    const logs: string[] = [];
    return { vault, rows, deps: { unit, vault, now: () => new Date(0), log: (m: string) => logs.push(m) }, logs };
  };

  it("writes the status, releases the abandoned order and skips the unknown one", async () => {
    const { vault, deps } = await setup();
    const results = await syncVaultReceipts(deps);
    expect(results.map((r) => [r.payoutId, r.action])).toEqual([
      ["po_paid", "set_status"],
      ["po_unpaid", "release"],
      ["po_missing", "none"],
    ]);
    expect((await vault.getReceipt("po_paid"))?.status).toBe("with_provider");
    expect((await vault.getReceipt("po_unpaid"))?.state).toBe("released");
    expect(await vault.getBalance(PAYER)).toEqual({ available: 15_000_000n, reserved: 0n, total: 15_000_000n });
  });

  it("is a no-op on the second pass", async () => {
    const { deps } = await setup();
    await syncVaultReceipts(deps);
    expect((await syncVaultReceipts(deps)).map((r) => r.action)).toEqual(["none", "none", "none"]);
  });

  it("logs a refusal by code and carries on with the next payout", async () => {
    const { deps, rows, logs } = await setup();
    rows[0] = payout("settled", { id: "po_paid" });
    const refusing: VaultClient = {
      registerOrder: (input) => deps.vault.registerOrder(input),
      setStatus: async () => Promise.reject(new VaultError("STATUS_BACKWARD")),
      recredit: (orderId, amount) => deps.vault.recredit(orderId, amount),
      releaseOrder: (orderId) => deps.vault.releaseOrder(orderId),
      getReceipt: (orderId) => deps.vault.getReceipt(orderId),
      getBalance: (accountId) => deps.vault.getBalance(accountId),
      getAgent: (owner, agentId) => deps.vault.getAgent(owner, agentId),
    };
    const failing = { ...deps, vault: refusing };
    const results = await syncVaultReceipts(failing);
    expect(results[0]).toEqual({ payoutId: "po_paid", action: "none", error: "STATUS_BACKWARD" });
    expect(results[1]?.action).toBe("release");
    expect(logs).toEqual(["[vault-sync] po_paid settled: STATUS_BACKWARD"]);
  });
});
