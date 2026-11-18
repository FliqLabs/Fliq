import type { NearRpc } from "../../../packages/chains/near/index.js";
import type { VaultClient } from "../../../packages/chains/vault/index.js";
import { vaultMirror } from "../../../packages/ledger/post.js";
import { formatTokenAmount } from "./dashboard.js";
import type { Unit } from "./db.js";
import { notFound } from "./errors.js";

export async function vaultInboxBalance(unit: Unit, nearRpc: NearRpc | null | undefined, usdcContract: string, userId: string) {
  const user = await unit((tx) => tx.user.findUnique({ where: { id: userId }, select: { nearAccount: true } }));
  if (!user?.nearAccount) throw notFound("Claim a fliq name to get a vault.");
  if (!nearRpc) return { usdc: "0.00", usdc_contract: usdcContract };
  const result = await nearRpc.callView(usdcContract, "ft_balance_of", { account_id: user.nearAccount });
  const units = typeof result === "string" && /^\d+$/.test(result) ? BigInt(result) : 0n;
  return { usdc: formatTokenAmount(units), usdc_contract: usdcContract };
}

// The chain is authoritative for vault funds. The ledger mirror is checked against it and the answer says if they agree.
export async function vaultBalance(unit: Unit, vault: VaultClient, userId: string) {
  const user = await unit((tx) => tx.user.findUnique({ where: { id: userId }, select: { nearAccount: true } }));
  if (!user?.nearAccount) throw notFound("Claim a fliq name to get a vault.");
  const chain = await vault.getBalance(user.nearAccount);
  const mirror = await unit((tx) => vaultMirror(tx, user.nearAccount as string, "USDC"));
  return {
    account: user.nearAccount,
    available: formatTokenAmount(chain.available),
    reserved: formatTokenAmount(chain.reserved),
    total: formatTokenAmount(chain.total),
    in_sync: chain.available === mirror.available && chain.reserved === mirror.reserved,
  };
}
