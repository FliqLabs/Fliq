import { PrismaClient } from "@prisma/client";
import { createNearRpc } from "../packages/chains/near/index.js";
import type { Asset } from "../packages/ledger/accounts.js";
import { vaultMirror } from "../packages/ledger/post.js";

// Prints, per vault holder, what the ledger mirror says is free and reserved next to what the vault contract says.
// Read only: the database reads run in a READ ONLY transaction and the chain is only viewed. It changes nothing, so a
// reconciliation can be planned from its output.

const need = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const rpc = createNearRpc({ url: need("NEAR_RPC_URL") });
const vaultId = need("VAULT_ACCOUNT");
const db = new PrismaClient();

const units = (value: unknown): bigint => (typeof value === "string" && /^\d+$/.test(value) ? BigInt(value) : 0n);

async function main() {
  const mirrors = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const accounts = await tx.account.findMany({ where: { code: { startsWith: "vault_available:" } }, select: { ownerId: true, asset: true }, orderBy: { code: "asc" } });
    const rows = [];
    for (const { ownerId, asset } of accounts) {
      if (!ownerId) continue;
      rows.push({ holder: ownerId, asset: asset as Asset, ...(await vaultMirror(tx, ownerId, asset as Asset)) });
    }
    return rows;
  });

  console.log(["holder", "asset", "ledger_available", "chain_available", "available_drift", "ledger_reserved", "chain_reserved", "reserved_drift"].join("\t"));
  for (const mirror of mirrors) {
    const balance = (await rpc.callView(vaultId, "get_balance", { account_id: mirror.holder })) as Record<string, unknown>;
    const chainAvailable = units(balance?.available);
    const chainReserved = units(balance?.reserved);
    console.log(
      [mirror.holder, mirror.asset, mirror.available, chainAvailable, mirror.available - chainAvailable, mirror.reserved, chainReserved, mirror.reserved - chainReserved].join("\t"),
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
