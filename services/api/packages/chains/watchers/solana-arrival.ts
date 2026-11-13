import type { SolanaRpc } from "./solana-rpc";

export type Arrival = { amount: bigint; txHash: string };

// The newest transaction on the owner's token account, if it paid this token in since the given time.
// Only the newest is read: public RPCs answer that at once and take seconds to page further back.
export async function latestSolanaArrival(
  rpc: SolanaRpc,
  owner: string,
  mint: string,
  since: Date,
): Promise<Arrival | null> {
  for (const account of await rpc.tokenAccounts(owner, mint)) {
    if (account.amount === 0n) continue;
    const [newest] = await rpc.signatures(account.address, { limit: 1 });
    if (!newest || newest.failed) continue;
    const credit = await rpc.tokenCredit(newest.signature, account.address);
    if (credit?.at && credit.at >= since) return { amount: credit.amount, txHash: newest.signature };
  }
  return null;
}
