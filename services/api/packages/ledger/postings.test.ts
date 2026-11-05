import { describe, expect, it } from "vitest";
import {
  depositReceived,
  deliveredToProvider,
  feeCollected,
  inTransit,
  refundCompleted,
  refundInitiated,
  settled,
  vaultReleased,
  vaultTransfer,
  vaultReserved,
  type Posting,
  type PayoutAmounts,
} from "./postings.js";

// Spec 6.3: 100 USDC on Base to Paycrest for an NGN bank payout, with a 0.30 USDC routing fee. Six decimals.
const USDC = (whole: number, cents = 0) => BigInt(whole) * 1_000_000n + BigInt(cents) * 10_000n;
const direct: PayoutAmounts = {
  payoutId: "po_golden",
  provider: "paycrest",
  asset: "USDC",
  gross: USDC(100),
  routingFee: USDC(0, 30),
  networkFee: 0n,
};

const byCode = (posting: Posting) => Object.fromEntries(posting.lines.map((line) => [line.account.code, line.amount]));
const sum = (posting: Posting) => posting.lines.reduce((total, line) => total + line.amount, 0n);

describe("spec 6.3 direct route, to the unit", () => {
  it("DEPOSIT_RECEIVED", () => {
    expect(byCode(depositReceived(direct))).toEqual({
      "provider_escrow:paycrest:USDC": 100_000_000n,
      "sender_external:USDC": -99_700_000n,
      "fee_revenue:USDC": -300_000n,
    });
  });

  it("SETTLED", () => {
    expect(byCode(settled(direct, { currency: "ngn" }))).toEqual({
      "recipient_paid:USDC": 99_700_000n,
      "fee_receivable:paycrest:USDC": 300_000n,
      "provider_escrow:paycrest:USDC": -100_000_000n,
    });
  });

  it("FEE_COLLECTED", () => {
    expect(byCode(feeCollected(direct))).toEqual({
      "fee_wallet:USDC": 300_000n,
      "fee_receivable:paycrest:USDC": -300_000n,
    });
  });

  it("a refund reverses the deposit entry once both refund postings are made", () => {
    const refund: Record<string, bigint> = {};
    for (const posting of [refundInitiated(direct), refundCompleted(direct)]) {
      for (const [code, amount] of Object.entries(byCode(posting))) refund[code] = (refund[code] ?? 0n) + amount;
    }
    expect(refund).toEqual({
      "sender_external:USDC": 99_700_000n,
      "fee_revenue:USDC": 300_000n,
      "provider_escrow:paycrest:USDC": -100_000_000n,
      "refund_in_flight:USDC": 0n,
    });
  });

  it("leaves every account at zero after deposit, settle and refund are netted against a deposit", () => {
    const deposit = byCode(depositReceived(direct));
    const refund: Record<string, bigint> = { ...deposit };
    for (const posting of [refundInitiated(direct), refundCompleted(direct)]) {
      for (const [code, amount] of Object.entries(byCode(posting))) refund[code] = (refund[code] ?? 0n) + amount;
    }
    expect(Object.values(refund).every((amount) => amount === 0n)).toBe(true);
  });
});

describe("Intents route", () => {
  const intents: PayoutAmounts = { ...direct, networkFee: USDC(0, 45) };

  it("holds the sender's funds in flight, then delivers net of the 1Click and chain fees", () => {
    expect(byCode(inTransit(intents))).toEqual({
      "intents_in_flight:USDC": 100_000_000n,
      "sender_external:USDC": -99_700_000n,
      "fee_revenue:USDC": -300_000n,
    });
    expect(byCode(deliveredToProvider(intents))).toEqual({
      "provider_escrow:paycrest:USDC": 99_550_000n,
      "network_fees:USDC": 450_000n,
      "intents_in_flight:USDC": -100_000_000n,
    });
  });

  it("settles on what the provider actually holds", () => {
    expect(byCode(settled(intents, {}))).toEqual({
      "recipient_paid:USDC": 99_250_000n,
      "fee_receivable:paycrest:USDC": 300_000n,
      "provider_escrow:paycrest:USDC": -99_550_000n,
    });
  });
});

describe("vault reservation", () => {
  it("moves the amount between free and reserved and back", () => {
    expect(byCode(vaultReserved("po_v", "frank.fliq.near", "USDC", USDC(50)))).toEqual({
      "vault_available:frank.fliq.near:USDC": 50_000_000n,
      "vault_reserved:frank.fliq.near:USDC": -50_000_000n,
    });
    expect(byCode(vaultReleased("po_v", "frank.fliq.near", "USDC", USDC(50)))).toEqual({
      "vault_reserved:frank.fliq.near:USDC": 50_000_000n,
      "vault_available:frank.fliq.near:USDC": -50_000_000n,
    });
  });
});

describe("vault transfer", () => {
  it("moves free balance from one holder to another", () => {
    const posting = vaultTransfer("tr_1", "frank.fliq.near", "tobi.fliq.near", "USDC", USDC(25));
    expect(byCode(posting)).toEqual({
      "vault_available:frank.fliq.near:USDC": 25_000_000n,
      "vault_available:tobi.fliq.near:USDC": -25_000_000n,
    });
    expect(sum(posting)).toBe(0n);
  });
});

describe("every posting balances to zero", () => {
  it("for any fee split", () => {
    for (const routingFee of [0n, 1n, 300_000n, 100_000_000n]) {
      for (const networkFee of [0n, 1n, 450_000n]) {
        const amounts = { ...direct, routingFee, networkFee };
        for (const posting of [
          depositReceived(amounts),
          inTransit(amounts),
          deliveredToProvider(amounts),
          settled(amounts, {}),
          feeCollected(amounts),
          refundInitiated(amounts),
          refundCompleted(amounts),
        ]) {
          expect(sum(posting), `${posting.type} fee=${routingFee} net=${networkFee}`).toBe(0n);
        }
      }
    }
  });
});
