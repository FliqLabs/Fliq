import { describe, expect, it } from "vitest";
import { latestSolanaArrival, type SignatureInfo, type SolanaRpc, type TokenCredit } from "./index";

const OWNER = "DepositOwner1111111111111111111111111111111";
const ACCOUNT = "DepositTokenAccount11111111111111111111111";
const MINT = "UsdcMint1111111111111111111111111111111111";
const SINCE = new Date("2026-11-13T11:15:00Z");

type Tx = { signature: string; failed?: boolean; amount: bigint; at: string | null };

// Newest first, as the RPC lists them.
function rpcWith(balance: bigint, txs: Tx[]) {
  const calls: string[] = [];
  const rpc: SolanaRpc = {
    async tokenAccounts(owner, mint) {
      calls.push(`accounts:${owner}:${mint}`);
      return [{ address: ACCOUNT, amount: balance }];
    },
    async signatures(address, page): Promise<SignatureInfo[]> {
      calls.push(`signatures:${address}:${page.limit}`);
      return txs
        .slice(0, page.limit)
        .map((tx) => ({ signature: tx.signature, slot: 900n, failed: tx.failed ?? false }));
    },
    async tokenCredit(signature): Promise<TokenCredit | null> {
      calls.push(`credit:${signature}`);
      const tx = txs.find((candidate) => candidate.signature === signature) as Tx;
      return {
        mint: MINT,
        amount: tx.amount,
        from: "SenderWallet",
        slot: 900n,
        at: tx.at ? new Date(tx.at) : null,
      };
    },
  };
  return { rpc, calls };
}

describe("latestSolanaArrival", () => {
  it("finds the transfer through the owner's token account and names its transaction", async () => {
    const { rpc, calls } = rpcWith(3_420_000n, [
      { signature: "SigNew", amount: 3_420_000n, at: "2026-11-13T11:16:41Z" },
    ]);
    expect(await latestSolanaArrival(rpc, OWNER, MINT, SINCE)).toEqual({
      amount: 3_420_000n,
      txHash: "SigNew",
    });
    expect(calls).toEqual([`accounts:${OWNER}:${MINT}`, `signatures:${ACCOUNT}:1`, "credit:SigNew"]);
  });

  it("asks nothing more while the account is empty", async () => {
    const { rpc, calls } = rpcWith(0n, [{ signature: "SigOld", amount: 1n, at: "2026-11-13T11:16:41Z" }]);
    expect(await latestSolanaArrival(rpc, OWNER, MINT, SINCE)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("waits for the next look when the newest transaction failed or has no time yet", async () => {
    const failed = rpcWith(5_000_000n, [
      { signature: "SigFailed", failed: true, amount: 5_000_000n, at: "2026-11-13T11:17:00Z" },
    ]);
    expect(await latestSolanaArrival(failed.rpc, OWNER, MINT, SINCE)).toBeNull();
    const untimed = rpcWith(5_000_000n, [{ signature: "SigUntimed", amount: 5_000_000n, at: null }]);
    expect(await latestSolanaArrival(untimed.rpc, OWNER, MINT, SINCE)).toBeNull();
  });

  it("does not take money that was there before the address was handed out", async () => {
    const { rpc } = rpcWith(1_479_963n, [
      { signature: "SigBefore", amount: 1_479_963n, at: "2026-11-13T11:14:59Z" },
    ]);
    expect(await latestSolanaArrival(rpc, OWNER, MINT, SINCE)).toBeNull();
  });
});
