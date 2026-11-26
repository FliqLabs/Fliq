import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { byRecency, lastSent, lookupHashOf, parseLabel, parseWallet, type WalletView } from "../apps/api/src/wallets.js";

const SOLANA = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const BASE = "0x76b4c56085ed136a8744d52be956396624a730e8";
const TRON = "TA4Wt1DUCqz6YegbnsmqsWC5uUfbdBqPxm";

const wallet = (id: string, created: string, sent: string | null): WalletView => ({
  wallet_id: id,
  label: id,
  chain: "solana",
  address: SOLANA,
  token: null,
  created_at: created,
  last_sent_at: sent,
});

describe("checking a wallet before it is saved", () => {
  it("accepts each chain fliq sends to, in its own address shape", () => {
    expect(parseWallet({ label: "Tunde's Binance", chain: "solana", address: ` ${SOLANA} ` })).toEqual({ label: "Tunde's Binance", chain: "solana", address: SOLANA, token: null });
    expect(parseWallet({ label: "Kemi", chain: "base", address: BASE, token: "usdc" }).token).toBe("usdc");
    expect(parseWallet({ label: "Kemi", chain: "bnb", address: BASE }).chain).toBe("bnb");
    expect(parseWallet({ label: "Ada", chain: "tron", address: TRON, token: "usdt" }).address).toBe(TRON);
    expect(parseWallet({ label: "Tobi", chain: "near", address: "Tobi.Fliq.Near" }).address).toBe("tobi.fliq.near");
  });

  it("refuses an address that is not for the chain, a chain fliq cannot send to, and the wrong token", () => {
    expect(() => parseWallet({ label: "x", chain: "solana", address: BASE })).toThrow(/not a Solana address/);
    expect(() => parseWallet({ label: "x", chain: "base", address: SOLANA })).toThrow(/not a Base address/);
    expect(() => parseWallet({ label: "x", chain: "base", address: "0x76b4c56085ed136a8744d52be956396624a730e" })).toThrow(/not a Base address/);
    expect(() => parseWallet({ label: "x", chain: "tron", address: `${TRON.slice(0, -1)}n` })).toThrow(/not a Tron address/);
    expect(() => parseWallet({ label: "x", chain: "near", address: "not a name!" })).toThrow(/not a NEAR address/);
    expect(() => parseWallet({ label: "x", chain: "ethereum", address: BASE })).toThrow(/cannot send to ethereum/);
    expect(() => parseWallet({ label: "x", chain: "tron", address: TRON, token: "usdc" })).toThrow(/sends USDT on Tron/);
  });

  it("needs a label of 40 characters or fewer, counted as people count them", () => {
    expect(() => parseLabel("   ")).toThrow(/label is required/);
    expect(() => parseLabel(undefined)).toThrow(/label is required/);
    expect(() => parseLabel("a".repeat(41))).toThrow(/40 characters/);
    expect(parseLabel("🦊".repeat(40))).toHaveLength(80);
    expect(parseLabel("  My Phantom ")).toBe("My Phantom");
  });
});

describe("finding a wallet saved before", () => {
  const key = randomBytes(32);

  it("treats an EVM address the same in any case, and a Solana one only exactly", () => {
    expect(lookupHashOf("base", BASE, key)).toEqual(lookupHashOf("base", BASE.toUpperCase().replace("0X", "0x"), key));
    expect(lookupHashOf("solana", SOLANA, key)).not.toEqual(lookupHashOf("solana", SOLANA.toLowerCase(), key));
  });

  it("keeps the same address on two chains apart", () => {
    expect(lookupHashOf("base", BASE, key)).not.toEqual(lookupHashOf("bnb", BASE, key));
  });
});

describe("ordering saved wallets", () => {
  it("puts the most recently sent to first, then the rest newest saved first", () => {
    const listed = [
      wallet("old-unsent", "2026-11-01T00:00:00.000Z", null),
      wallet("sent-long-ago", "2026-11-02T00:00:00.000Z", "2026-11-03T00:00:00.000Z"),
      wallet("new-unsent", "2026-11-05T00:00:00.000Z", null),
      wallet("sent-today", "2026-10-01T00:00:00.000Z", "2026-11-20T00:00:00.000Z"),
    ].sort(byRecency);
    expect(listed.map((item) => item.wallet_id)).toEqual(["sent-today", "sent-long-ago", "new-unsent", "old-unsent"]);
  });

  it("takes the latest send to the same chain and address, matching EVM case", () => {
    const sent = [
      { chain: "base", address: BASE.toUpperCase().replace("0X", "0x"), at: new Date("2026-11-20T00:00:00Z") },
      { chain: "base", address: BASE, at: new Date("2026-11-10T00:00:00Z") },
      { chain: "bnb", address: BASE, at: new Date("2026-11-25T00:00:00Z") },
    ];
    expect(lastSent(sent, "base", BASE)?.toISOString()).toBe("2026-11-20T00:00:00.000Z");
    expect(lastSent(sent, "solana", SOLANA)).toBeNull();
  });
});
