import { decrypt } from "../../../packages/db/src/crypto.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { notFound } from "./errors.js";
import { bankReference } from "./payouts.js";

// Enough to recognise the payout without exposing who was paid: initials and the last four digits.
export function maskAccount(name: string, number: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0)}***`)
    .join(" ");
  return `${initials} ···${number.slice(-4)}`;
}

export async function publicReceipt(tx: Db, config: Config, payoutId: string) {
  const payout = await tx.payout.findUnique({ where: { id: payoutId }, include: { recipient: true, events: { orderBy: { version: "asc" } } } });
  if (!payout) throw notFound("No such receipt.");
  const at = (state: string) => payout.events.find((event) => event.toState === state)?.createdAt;
  const settledAt = at("settled");
  const seenAt = at("deposit_seen");
  return {
    payout_id: payout.id,
    state: payout.state,
    receive: Number(payout.amountOutMinor / 100n),
    currency: payout.currency,
    account_masked: maskAccount(decrypt(payout.recipient.nameCipher, config.dataKey), decrypt(payout.recipient.accountCipher, config.dataKey)),
    institution: payout.recipient.institutionCode,
    provider: payout.provider,
    created_at: payout.createdAt.toISOString(),
    settled_at: settledAt?.toISOString() ?? null,
    seconds: settledAt && seenAt ? Math.round((settledAt.getTime() - seenAt.getTime()) / 1000) : null,
    bank_reference: bankReference(payout.events),
    vault_receipt: payout.routeKind === "intents" && payout.depositChain === "near" ? payout.id : null,
    provider_order: payout.providerOrderId,
  };
}
