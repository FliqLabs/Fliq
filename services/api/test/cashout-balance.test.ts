import { describe, expect, it } from "vitest";
import type { Unit } from "../apps/api/src/db.js";
import type { OneClickHops } from "../apps/api/src/hop.js";
import { DEFAULT_DEADLINE_MARGIN_MS, DEFAULT_GUARD_BPS, DEFAULT_VELOCITY, openOrder } from "../apps/api/src/payouts.js";
import { maxSendAmount, providerFeeCap, saveQuote, totalDebit, type PricedQuote } from "../apps/api/src/quotes.js";
import { VaultError, type VaultClient } from "../packages/chains/vault/index.js";
import { DEFAULT_ROUTING_CONFIG, NO_SIGNALS, type Route } from "../packages/domain/routing.js";
import type { CreatedOrder, ProviderAdapter } from "../packages/providers/types.js";

const NOW = new Date("2026-11-24T12:00:00Z");
const PAYER = "olien.fliq.near";
// 10.05 USDC on NEAR buys 10.00 USDC on Base, as a 1Click hop would quote it.
const HOP = { chain: "base" as const, amountIn: 10_050_000n, amountOut: 10_000_000n, seconds: 20 };
// Paycrest adds its network fee to the order once it exists.
const PROVIDER_FEE = 50_000n;
const SWAP_IN = 10_100_000n;
const ORDER: Omit<CreatedOrder, "funding"> = { providerOrderId: "pc_order_1", reference: "po_test" };

// Just enough of a Prisma transaction for the ledger postings openOrder makes. The mirror reads back whatever the test
// sets, so it can disagree with the chain the way production's did.
function ledger(mirrorAvailable: bigint) {
  const postings: string[] = [];
  const payoutUpdates: object[] = [];
  const tx = {
    $executeRaw: async () => 0,
    journalEntry: {
      findUnique: async () => null,
      create: async ({ data }: { data: { postingType: string } }) => (postings.push(data.postingType), data),
    },
    account: { upsert: async ({ create }: { create: { id: string } }) => create },
    journalLine: { createMany: async () => ({ count: 0 }) },
    balance: { findFirst: async () => ({ amount: -mirrorAvailable }) },
    payout: { update: async ({ data }: { data: object }) => (payoutUpdates.push(data), data) },
  };
  const unit = (async (fn: (db: typeof tx) => unknown) => fn(tx)) as unknown as Unit;
  return { unit, postings, payoutUpdates };
}

// The chain answers each balance read in turn, repeating the last answer.
function chain(balances: bigint[], registerOrder: VaultClient["registerOrder"] = async () => ({ txHash: "tx" })) {
  const reads = [...balances];
  const registered: string[] = [];
  const vault = {
    getBalance: async () => {
      const available = reads.length > 1 ? (reads.shift() as bigint) : (reads[0] as bigint);
      return { available, reserved: 0n, total: available };
    },
    registerOrder: async (input: Parameters<VaultClient["registerOrder"]>[0]) => {
      registered.push(input.orderId);
      return registerOrder(input);
    },
  } as unknown as VaultClient;
  return { vault, registered };
}

function payout(options: { mirror: bigint; vault: VaultClient }) {
  const { unit, postings, payoutUpdates } = ledger(options.mirror);
  const orders: string[] = [];
  const adapter = {
    id: "paycrest",
    async createOrder(request: { payoutId: string }) {
      orders.push(request.payoutId);
      return {
        ...ORDER,
        funding: { kind: "deposit_address", chain: "base", asset: "USDC", address: "0xpaycrest", units: HOP.amountOut + PROVIDER_FEE, validUntil: new Date(NOW.getTime() + 15 * 60_000) },
      };
    },
  } as unknown as ProviderAdapter;
  const hops = {
    depositQuote: async () => ({ depositAddress: "dep.1click.near", amountIn: SWAP_IN, minAmountIn: SWAP_IN }),
  } as unknown as OneClickHops;
  const run = () =>
    openOrder({
      deps: {
        config: { hashKey: Buffer.alloc(32, 1) } as never,
        adapters: [adapter],
        velocity: DEFAULT_VELOCITY,
        now: () => NOW,
        quotes: { adapters: [adapter], routing: DEFAULT_ROUTING_CONFIG, signals: NO_SIGNALS, now: () => NOW },
        intents: { hops, vault: options.vault, tokenStorage: { ensure: async () => undefined }, guardBps: DEFAULT_GUARD_BPS, deadlineMarginMs: DEFAULT_DEADLINE_MARGIN_MS },
      },
      unit,
      adapter,
      userId: "usr_1",
      payoutId: "po_test",
      providerQuote: { provider: "paycrest", sendUnits: HOP.amountOut, receiveMinorUnits: 1_500_000n, rate: "1500", fees: [], expiresAt: NOW },
      corridor: { country: "NG", currency: "NGN", payoutType: "bank" },
      asset: "USDC",
      prepared: {
        quote: { id: "q_1", currency: "ngn", tokenSymbol: "USDC", sourceChain: "near", mode: "send_exactly", amountIn: HOP.amountIn, amountOutMinor: 1_500_000n },
        route: { provider: "paycrest", amountIn: HOP.amountIn },
        payer: PAYER,
        refundAddress: "0x2222222222222222222222222222222222222222",
        intents: true,
        hop: HOP,
      },
      recipient: { institutionCode: "058", accountNumber: "0123456789", accountName: "DARA OKONKWO" },
    });
  return { run, orders, postings, payoutUpdates };
}

describe("the vault contract decides whether a payer can afford a cash-out", () => {
  // Production, 24 Nov: sirleeem's mirror said 21.97 USDC free while the vault held 0.53, and the reverse for others.
  it("pays when the chain holds enough, even though the ledger mirror says the payer has nothing", async () => {
    const { vault, registered } = chain([20_000_000n]);
    const attempt = payout({ mirror: -2_940_000n, vault });
    const opened = await attempt.run();
    expect(opened.kind).toBe("ready");
    expect(registered).toEqual(["po_test"]);
    expect(attempt.postings).toEqual(["VAULT_RESERVED"]);
  });

  it("refuses before any provider order when the chain is short, even though the mirror says plenty", async () => {
    const { vault } = chain([530_000n]);
    const attempt = payout({ mirror: 21_970_000n, vault });
    const opened = await attempt.run();
    expect(opened).toMatchObject({ kind: "insufficient_balance", shortfall: { check: "before_order", needed: totalDebit(HOP, "USDC"), held: 530_000n } });
    expect(attempt.orders).toEqual([]);
  });

  it("counts the fees: a balance that covers the typed amount but not the total is refused up front", async () => {
    const { vault } = chain([HOP.amountIn + 10_000n]);
    const opened = await payout({ mirror: 0n, vault }).run();
    expect(opened).toMatchObject({ kind: "insufficient_balance", shortfall: { check: "before_order" } });
  });

  it("refuses against the swap's real deposit and keeps the provider order", async () => {
    const { vault, registered } = chain([20_000_000n, SWAP_IN - 1n]);
    const attempt = payout({ mirror: 20_000_000n, vault });
    const opened = await attempt.run();
    expect(opened).toMatchObject({ kind: "insufficient_balance", shortfall: { check: "swap_deposit", needed: SWAP_IN, held: SWAP_IN - 1n } });
    expect(opened.order?.providerOrderId).toBe(ORDER.providerOrderId);
    expect(registered).toEqual([]);
    expect(attempt.postings).toEqual([]);
  });
});

describe("a vault that refuses the order", () => {
  it("reads INSUFFICIENT_BALANCE from the contract as a balance problem and gives the reservation back", async () => {
    const { vault } = chain([20_000_000n, 20_000_000n, 9_000_000n], async () => {
      throw new VaultError("INSUFFICIENT_BALANCE");
    });
    const attempt = payout({ mirror: 20_000_000n, vault });
    const opened = await attempt.run();
    expect(opened).toMatchObject({ kind: "insufficient_balance", shortfall: { check: "register_order", needed: SWAP_IN, held: 9_000_000n } });
    expect(opened.order?.providerOrderId).toBe(ORDER.providerOrderId);
    expect(attempt.postings).toEqual(["VAULT_RESERVED", "VAULT_RELEASED"]);
  });

  it("still calls any other refusal a route that is down, and keeps the provider order", async () => {
    const { vault } = chain([20_000_000n], async () => {
      throw new Error("rpc timeout");
    });
    const opened = await payout({ mirror: 20_000_000n, vault }).run();
    expect(opened).toMatchObject({ kind: "route_unavailable", order: { providerOrderId: ORDER.providerOrderId } });
  });
});

describe("the total a quote debits", () => {
  const cap = providerFeeCap("USDC");

  it("adds the provider fee cap and prices it at the hop's spread, rounding up", () => {
    expect(cap).toBe(250_000n);
    expect(totalDebit(HOP, "USDC")).toBe(10_301_250n);
    expect(totalDebit({ amountIn: 3n, amountOut: 2n }, "USDC")).toBe(375_003n);
  });

  it("gives the largest send amount whose total fits what the payer holds", () => {
    for (const available of [147_540_000n, 530_000n, 1_870_000n, 10_301_250n]) {
      const max = maxSendAmount(HOP.amountIn, HOP, "USDC", available);
      const at = (amountIn: bigint) => totalDebit({ amountIn, amountOut: (amountIn * HOP.amountOut) / HOP.amountIn }, "USDC");
      expect(at(max)).toBeLessThanOrEqual(available);
      expect(at(max + 1n)).toBeGreaterThan(available);
    }
    expect(maxSendAmount(HOP.amountIn, HOP, "USDC", 10_301_250n)).toBe(HOP.amountIn);
  });

  it("is zero when the balance cannot even cover the fee", () => {
    expect(maxSendAmount(HOP.amountIn, HOP, "USDC", 60_000n)).toBe(0n);
    expect(maxSendAmount(HOP.amountIn, HOP, "USDC", 0n)).toBe(0n);
  });
});

describe("a quote for an Intents route", () => {
  const route: Route = {
    rank: 1,
    kind: "intents",
    hop: HOP,
    provider: "paycrest",
    providerQuote: { provider: "paycrest", sendUnits: HOP.amountOut, receiveMinorUnits: 1_500_000n, rate: "1500", fees: [], expiresAt: new Date(NOW.getTime() + 60_000) },
    amountIn: HOP.amountIn,
    amountOutMinor: 1_500_000n,
    fees: { provider: 0n, network: 0n, intents: 7_500n, ours: 0n },
    etaSeconds: 60,
    expiresAt: new Date(NOW.getTime() + 60_000),
    breakdown: { amount: 1, reliability: 1, speed: 1, weights: {} as never, halfOpen: false, total: 1 },
  };
  const priced = { routes: [route], dropped: [], expiresAt: new Date(NOW.getTime() + 60_000), now: NOW } as unknown as PricedQuote;
  const tx = {
    workspace: { findFirst: async () => null },
    quote: { create: async () => ({}) },
    quoteRoute: { createMany: async () => ({ count: 1 }) },
  } as never;
  const input = { token: "usdc", currency: "ngn", amount: "10.05" } as const;

  it("returns the total debit and, when the payer is known, the most they can send", async () => {
    const quote = await saveQuote(tx, "usr_1", input, priced, 1_870_000n);
    expect(quote.total_debit).toBe("10301250");
    expect(quote.max_amount).toBe(maxSendAmount(HOP.amountIn, HOP, "USDC", 1_870_000n).toString());
  });

  it("leaves max_amount out when the payer's balance is unknown", async () => {
    const quote = await saveQuote(tx, "usr_1", input, priced);
    expect(quote.total_debit).toBe("10301250");
    expect(quote).not.toHaveProperty("max_amount");
  });

  it("returns neither for a direct route", async () => {
    const direct = { ...priced, routes: [{ ...route, kind: "direct" as const, hop: null }] } as PricedQuote;
    const quote = await saveQuote(tx, "usr_1", input, direct, 1_870_000n);
    expect(quote).not.toHaveProperty("total_debit");
    expect(quote).not.toHaveProperty("max_amount");
  });
});
