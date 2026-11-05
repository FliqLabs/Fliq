import type { VaultClient } from "../../../packages/chains/vault/index.js";
import { vaultMirror } from "../../../packages/ledger/post.js";
import { formatTokenAmount } from "./dashboard.js";
import type { Unit } from "./db.js";
import { notFound } from "./errors.js";

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
