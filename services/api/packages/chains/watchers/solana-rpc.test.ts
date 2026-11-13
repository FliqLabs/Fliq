import { describe, expect, it } from "vitest";
import { createSolanaRpc, RpcError } from "./index";

// Shapes follow the Solana JSON-RPC getSignaturesForAddress and getTransaction (jsonParsed) results. Modelled, not captured.
const ACCOUNT = "DepositTokenAccount11111111111111111111111";
const SENDER_ACCOUNT = "SenderTokenAccount111111111111111111111111";
const MINT = "UsdcMint1111111111111111111111111111111111";

function rpcReturning(result: unknown) {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = async (_: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  };
  const rpc = createSolanaRpc({
    url: "https://solana.example.com/?api-key=k",
    commitment: "finalized",
    fetch: fetchImpl as typeof fetch,
  });
  return { rpc, bodies };
}

const balance = (accountIndex: number, amount: string, owner: string) => ({
  accountIndex,
  mint: MINT,
  owner,
  programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  uiTokenAmount: { amount, decimals: 6, uiAmount: Number(amount) / 1e6, uiAmountString: "" },
});

const transaction = (meta: Record<string, unknown>) => ({
  slot: 321,
  blockTime: 1_762_344_000,
  transaction: {
    message: {
      accountKeys: [
        {
          pubkey: "FeePayer1111111111111111111111111111111111",
          signer: true,
          writable: true,
          source: "transaction",
        },
        { pubkey: SENDER_ACCOUNT, signer: false, writable: true, source: "transaction" },
        { pubkey: ACCOUNT, signer: false, writable: true, source: "lookupTable" },
      ],
    },
  },
  meta: { err: null, ...meta },
});

describe("createSolanaRpc", () => {
  it("asks for finalized signatures with paging and reads failures", async () => {
    const { rpc, bodies } = rpcReturning([
      { signature: "Sig2", slot: 12, err: null, memo: null, blockTime: 1, confirmationStatus: "finalized" },
      { signature: "Sig1", slot: 11, err: { InstructionError: [0, "Custom"] }, memo: null, blockTime: 1 },
    ]);
    const page = await rpc.signatures(ACCOUNT, { until: "Sig0", limit: 5000 });
    expect(bodies[0]).toMatchObject({
      method: "getSignaturesForAddress",
      params: [ACCOUNT, { commitment: "finalized", limit: 1000, until: "Sig0" }],
    });
    expect(page).toEqual([
      { signature: "Sig2", slot: 12n, failed: false },
      { signature: "Sig1", slot: 11n, failed: true },
    ]);
  });

  it("lists the owner's token accounts for a mint with their balances", async () => {
    // Captured from mainnet getTokenAccountsByOwner on 13 November 2026, trimmed to one account.
    const { rpc, bodies } = rpcReturning({
      context: { slot: 468982896, apiVersion: "4.3.0-beta.2" },
      value: [
        {
          pubkey: "48764TRU46vjqUeaKtotv4kwMS1NYUdY3sF9B2ryYmfY",
          account: {
            lamports: 1488440,
            data: {
              program: "spl-token",
              parsed: {
                info: {
                  isNative: false,
                  mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                  owner: "kUCN2wM26BxiMXPpsRNtZNv6YUdESQ1QpiMf2EffeGt",
                  state: "initialized",
                  tokenAmount: {
                    amount: "1479963",
                    decimals: 6,
                    uiAmount: 1.479963,
                    uiAmountString: "1.479963",
                  },
                },
                type: "account",
              },
              space: 165,
            },
            owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
            executable: false,
            space: 165,
          },
        },
      ],
    });
    expect(
      await rpc.tokenAccounts(
        "kUCN2wM26BxiMXPpsRNtZNv6YUdESQ1QpiMf2EffeGt",
        "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      ),
    ).toEqual([{ address: "48764TRU46vjqUeaKtotv4kwMS1NYUdY3sF9B2ryYmfY", amount: 1_479_963n }]);
    expect(bodies[0]).toMatchObject({
      method: "getTokenAccountsByOwner",
      params: [
        "kUCN2wM26BxiMXPpsRNtZNv6YUdESQ1QpiMf2EffeGt",
        { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
        { encoding: "jsonParsed", commitment: "finalized" },
      ],
    });
    expect(await rpcReturning({ context: { slot: 1 }, value: [] }).rpc.tokenAccounts("Owner", MINT)).toEqual(
      [],
    );
  });

  it("measures what the token account gained and who sent it", async () => {
    const { rpc, bodies } = rpcReturning(
      transaction({
        preTokenBalances: [balance(1, "80000000", "SenderWallet")],
        postTokenBalances: [balance(1, "30000000", "SenderWallet"), balance(2, "50000000", "Receiver")],
      }),
    );
    expect(await rpc.tokenCredit("Sig", ACCOUNT)).toEqual({
      mint: MINT,
      amount: 50_000_000n,
      from: "SenderWallet",
      slot: 321n,
      at: new Date(1_762_344_000 * 1000),
    });
    expect(bodies[0]).toMatchObject({
      method: "getTransaction",
      params: ["Sig", { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }],
    });
  });

  it("returns null for an unknown transaction, a failed one, or one that did not credit the account", async () => {
    expect(await rpcReturning(null).rpc.tokenCredit("Sig", ACCOUNT)).toBeNull();
    const failed = transaction({
      err: { InstructionError: [0, "Custom"] },
      postTokenBalances: [balance(2, "5", "R")],
    });
    expect(await rpcReturning(failed).rpc.tokenCredit("Sig", ACCOUNT)).toBeNull();
    const outgoing = transaction({
      preTokenBalances: [balance(2, "50000000", "Receiver")],
      postTokenBalances: [balance(2, "10000000", "Receiver")],
    });
    expect(await rpcReturning(outgoing).rpc.tokenCredit("Sig", ACCOUNT)).toBeNull();
  });

  it("rejects malformed token balances as invalid responses", async () => {
    const decimal = transaction({
      preTokenBalances: [],
      postTokenBalances: [{ ...balance(2, "1", "R"), uiTokenAmount: { amount: "1.5" } }],
    });
    const outOfRange = transaction({ preTokenBalances: [], postTokenBalances: [balance(9, "1", "R")] });
    for (const body of [decimal, outOfRange]) {
      const error = await rpcReturning(body)
        .rpc.tokenCredit("Sig", ACCOUNT)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RpcError);
      expect(error).toMatchObject({ kind: "invalid_response" });
    }
  });
});
