import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase, unitOf } from "../apps/api/src/db.js";
import { syncVaultReceipts, type SyncedPayout } from "../apps/api/src/vault-sync.js";
import { MockVault } from "../packages/chains/vault/index.js";
import { postEntry, reserveVault, vaultMirror } from "../packages/ledger/post.js";
import { vaultCredited } from "../packages/ledger/postings.js";

const enabled = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") && Boolean(process.env.FLIQ_ACCESS_SECRET);

describe.skipIf(!enabled)("vault sync keeps the ledger mirror in step with released orders", () => {
  const database = createDatabase();
  const unit = unitOf(database);
  const suffix = randomBytes(4).toString("hex");
  const payer = `payer-${suffix}.test.near`;
  const NOW_NS = 1_800_000_000_000_000_000n;
  afterAll(() => database.$disconnect());

  // Mainnet, 11 Nov: a cash-out reserved 10.070359 USDC, the payer never signed, the order was released on chain,
  // and the mirror still held the reservation, so the next cash-out was refused with 16.08 USDC in the vault.
  it("frees the mirror's reservation when the chain releases the order, once", async () => {
    const vault = new MockVault({ registrar: "registrar.test.near", usdc: "usdc.test.near", now: () => NOW_NS });
    vault.registerStorage(payer);
    vault.ftOnTransfer({ predecessor: "usdc.test.near", senderId: payer, amount: 16_082_137n, msg: "" });
    const orderId = `po_${suffix}`;
    await unit((tx) => postEntry(tx, vaultCredited(`dep_${suffix}`, payer, "USDC", 16_082_137n)));
    await unit((tx) => reserveVault(tx, orderId, payer, "USDC", 10_070_359n));
    await vault.registerOrder({ orderId, payer, depositAddress: "dep.test.near", amount: 10_070_359n, expiresAtNs: NOW_NS + 1n, corridor: "NG-NGN-bank" });
    expect(await unit((tx) => vaultMirror(tx, payer, "USDC"))).toEqual({ available: 6_011_778n, reserved: 10_070_359n });

    const rows: SyncedPayout[] = [{ id: orderId, state: "expired", provider: "paycrest", providerOrderId: null }];
    const listing = (async (fn: (tx: unknown) => unknown) =>
      unit((tx) => fn(new Proxy(tx, { get: (target, key) => (key === "payout" ? { findMany: async () => rows } : Reflect.get(target, key)) })) as Promise<unknown>)) as unknown as typeof unit;
    const deps = { unit: listing, vault, now: () => new Date(), log: () => undefined };

    expect((await syncVaultReceipts(deps)).map((r) => r.action)).toEqual(["release"]);
    expect(await unit((tx) => vaultMirror(tx, payer, "USDC"))).toEqual({ available: 16_082_137n, reserved: 0n });

    await syncVaultReceipts(deps);
    expect(await unit((tx) => vaultMirror(tx, payer, "USDC"))).toEqual({ available: 16_082_137n, reserved: 0n });
  });
});
