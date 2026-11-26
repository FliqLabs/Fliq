import type { SavedWallet } from "@prisma/client";
import { NEAR_ACCOUNT } from "../../../packages/chains/near/policy.js";
import { decrypt, encrypt, keyedHash } from "../../../packages/db/src/crypto.js";
import { newId } from "../../../packages/db/src/ids.js";
import type { Config } from "./config.js";
import type { Db, Unit } from "./db.js";
import { invalidRequest, notFound } from "./errors.js";
import { SEND_NETWORKS, type SendToken } from "./sends.js";

// Wallets the user named so they can send to them again. NEAR is a direct transfer; the others go through NEAR Intents.
export const WALLET_CHAINS = ["near", ...SEND_NETWORKS.map((network) => network.chain)] as const;
export type WalletChain = (typeof WALLET_CHAINS)[number];

export const LABEL_MAX = 40;

export interface WalletInput {
  label: string;
  chain: string;
  address: string;
  token?: string;
}

type Keys = Pick<Config, "dataKey" | "hashKey">;

const nameOf = (chain: string) => (chain === "near" ? "NEAR" : (SEND_NETWORKS.find((network) => network.chain === chain)?.name ?? chain));

// NEAR names are lower case and EVM addresses mean the same in any case. Solana and Tron are case sensitive.
export function normalizeAddress(chain: string, typed: string): string {
  const address = typed.trim();
  return chain === "near" ? address.toLowerCase() : address;
}

const sameAddress = (chain: string, a: string, b: string) => (chain === "base" || chain === "bnb" ? a.toLowerCase() === b.toLowerCase() : a === b);

export function isWalletAddress(chain: string, address: string): boolean {
  if (chain === "near") return NEAR_ACCOUNT.test(address);
  return SEND_NETWORKS.find((network) => network.chain === chain)?.isAddress(address) ?? false;
}

export function parseLabel(raw: unknown): string {
  const label = typeof raw === "string" ? raw.trim() : "";
  if (!label) throw invalidRequest("label is required.");
  if ([...label].length > LABEL_MAX) throw invalidRequest(`label must be ${LABEL_MAX} characters or fewer.`);
  return label;
}

export function parseWallet(input: WalletInput): { label: string; chain: WalletChain; address: string; token: SendToken | null } {
  const label = parseLabel(input.label);
  const chain = WALLET_CHAINS.find((known) => known === input.chain);
  if (!chain) throw invalidRequest(`fliq cannot send to ${input.chain} yet.`);
  const address = normalizeAddress(chain, typeof input.address === "string" ? input.address : "");
  if (!isWalletAddress(chain, address)) throw invalidRequest(`That is not a ${nameOf(chain)} address. Check it and try again.`);
  if (input.token === undefined) return { label, chain, address, token: null };
  const sends = chain === "near" ? "usdc" : SEND_NETWORKS.find((network) => network.chain === chain)?.token;
  if (input.token !== sends) throw invalidRequest(`fliq sends ${sends?.toUpperCase()} on ${nameOf(chain)}.`);
  return { label, chain, address, token: input.token };
}

export const lookupHashOf = (chain: string, address: string, hashKey: Buffer) =>
  keyedHash(`wallet:${chain}:${chain === "base" || chain === "bnb" ? address.toLowerCase() : address}`, hashKey);

function view(keys: Keys, row: SavedWallet, lastSentAt: Date | null) {
  return {
    wallet_id: row.id,
    label: row.label,
    chain: row.chain,
    address: decrypt(row.addressCipher, keys.dataKey),
    token: row.token,
    created_at: row.createdAt.toISOString(),
    last_sent_at: lastSentAt?.toISOString() ?? null,
  };
}

export type WalletView = ReturnType<typeof view>;

// Newest send first, then wallets never sent to, newest saved first.
export function byRecency(a: WalletView, b: WalletView): number {
  if (a.last_sent_at !== b.last_sent_at) {
    if (!a.last_sent_at) return 1;
    if (!b.last_sent_at) return -1;
    return b.last_sent_at.localeCompare(a.last_sent_at);
  }
  return b.created_at.localeCompare(a.created_at) || b.wallet_id.localeCompare(a.wallet_id);
}

type Sent = { chain: string; address: string; at: Date };

// Sends are already recorded with their destination: a send to another network once the user's transfer left NEAR,
// and a NEAR transfer to an outside wallet. The latest one to each wallet is its last send.
async function sentTo(tx: Db, userId: string): Promise<Sent[]> {
  const [crossChain, onNear] = await Promise.all([
    tx.walletSend.groupBy({ by: ["chain", "toAddress"], where: { userId, originTx: { not: null } }, _max: { createdAt: true } }),
    tx.transfer.groupBy({ by: ["toAccount"], where: { fromUserId: userId }, _max: { createdAt: true } }),
  ]);
  return [
    ...crossChain.map((row) => ({ chain: row.chain, address: row.toAddress, at: row._max.createdAt as Date })),
    ...onNear.map((row) => ({ chain: "near", address: row.toAccount, at: row._max.createdAt as Date })),
  ];
}

export function lastSent(sent: readonly Sent[], chain: string, address: string): Date | null {
  const times = sent.filter((send) => send.chain === chain && sameAddress(chain, send.address, address)).map((send) => send.at.getTime());
  return times.length ? new Date(Math.max(...times)) : null;
}

async function withLastSent(tx: Db, keys: Keys, userId: string, rows: SavedWallet[]): Promise<WalletView[]> {
  if (rows.length === 0) return [];
  const sent = await sentTo(tx, userId);
  return rows.map((row) => {
    const address = decrypt(row.addressCipher, keys.dataKey);
    return view(keys, row, lastSent(sent, row.chain, address));
  });
}

export async function listWallets(tx: Db, keys: Keys, userId: string) {
  const rows = await tx.savedWallet.findMany({ where: { userId, deletedAt: null } });
  return { items: (await withLastSent(tx, keys, userId, rows)).sort(byRecency) };
}

// Saving a wallet already saved keeps the one row and takes the new label, so a second save never makes a duplicate.
export async function saveWallet(unit: Unit, keys: Keys, userId: string, input: WalletInput) {
  const wallet = parseWallet(input);
  const lookupHash = lookupHashOf(wallet.chain, wallet.address, keys.hashKey);
  return unit(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet:${userId}`}, 0))`;
    const existing = await tx.savedWallet.findUnique({ where: { userId_lookupHash: { userId, lookupHash } } });
    const live = existing && !existing.deletedAt;
    const row = existing
      ? await tx.savedWallet.update({
          where: { id: existing.id },
          data: { label: wallet.label, deletedAt: null, ...(wallet.token ? { token: wallet.token } : {}) },
        })
      : await tx.savedWallet.create({
          data: {
            id: newId("wal"),
            userId,
            label: wallet.label,
            chain: wallet.chain,
            token: wallet.token,
            addressCipher: encrypt(wallet.address, keys.dataKey),
            lookupHash,
          },
        });
    const [saved] = await withLastSent(tx, keys, userId, [row]);
    return { status: live ? 200 : 201, body: saved as WalletView };
  });
}

export async function renameWallet(tx: Db, keys: Keys, userId: string, walletId: string, input: { label?: unknown }) {
  const label = parseLabel(input.label);
  const renamed = await tx.savedWallet.updateMany({ where: { id: walletId, userId, deletedAt: null }, data: { label } });
  if (renamed.count === 0) throw notFound("No such saved wallet.");
  const row = await tx.savedWallet.findUniqueOrThrow({ where: { id: walletId } });
  const [updated] = await withLastSent(tx, keys, userId, [row]);
  return updated as WalletView;
}

export async function deleteWallet(tx: Db, userId: string, walletId: string): Promise<void> {
  const removed = await tx.savedWallet.updateMany({ where: { id: walletId, userId, deletedAt: null }, data: { deletedAt: new Date() } });
  if (removed.count === 0) throw notFound("No such saved wallet.");
}
