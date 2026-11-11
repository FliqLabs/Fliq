import { decrypt, encrypt, keyedHash } from "../../../packages/db/src/crypto.js";
import { newId } from "../../../packages/db/src/ids.js";
import { ProviderError } from "../../../packages/providers/errors.js";
import type { Country, ProviderAdapter } from "../../../packages/providers/types.js";
import type { Config } from "./config.js";
import type { Db, Unit } from "./db.js";
import { ApiError, invalidRequest, notFound } from "./errors.js";
import { institutionsIn } from "../../../packages/providers/institutions/translate.js";
import { COUNTRY_CODE, FEATURED_CODES, institutionName, logoKeyFor } from "./institutions.js";

export interface AccountLookup {
  bank: string;
  number: string;
  country?: string;
  account_name?: string;
}

export interface RecipientDeps {
  config: Config;
  adapters: readonly ProviderAdapter[];
}

const ACCOUNT_NUMBER = /^[0-9]{6,20}$/;

function countryOf(code: string | undefined): Country {
  const country = COUNTRY_CODE[(code ?? "ng").toLowerCase()];
  if (!country) throw invalidRequest("country is not supported.");
  return country;
}

// Table institutions come first in the table's order, then any a provider lists that the table does not know.
export async function listInstitutions(adapters: readonly ProviderAdapter[], countryParam: string | undefined) {
  const country = countryOf(countryParam);
  const lower = country.toLowerCase();
  const fromProviders = await Promise.all(adapters.map((adapter) => adapter.institutions(country).catch(() => [])));
  const offered = new Map(fromProviders.flat().map((institution) => [institution.code, institution]));
  const featured = institutionsIn(country).filter((entry) => FEATURED_CODES.includes(entry.code));
  for (const entry of featured) if (!offered.has(entry.code)) offered.set(entry.code, { code: entry.code, name: entry.name, type: entry.type });
  const rank = new Map(institutionsIn(country).map((entry, index) => [entry.code, index]));
  const items = [...offered.values()]
    .sort((a, b) => (rank.get(a.code) ?? Infinity) - (rank.get(b.code) ?? Infinity) || a.name.localeCompare(b.name))
    .map((institution) => ({ code: institution.code, name: institutionName(institution.code), type: institution.type, country: lower, logo_key: logoKeyFor(institution.code) }));
  return { items };
}

// Paycrest answers "OK" instead of a name for banks it cannot look up. Then the sender supplies the name
// and the response says it was not confirmed by the bank.
export function resolveName(bankName: string | null, supplied: string | undefined): { name: string; verified: boolean } {
  if (bankName) return { name: bankName, verified: true };
  const name = supplied?.trim();
  if (!name) throw new ApiError(422, "account_name_required", "The bank cannot confirm names for this account. Enter the account name.");
  return { name, verified: false };
}

// The first provider that knows the account answers. A provider outage is skipped, not fatal.
export async function verifyAccount(adapters: readonly ProviderAdapter[], lookup: AccountLookup) {
  if (!ACCOUNT_NUMBER.test(lookup.number)) throw invalidRequest("number must be 6 to 20 digits.");
  const country = countryOf(lookup.country);
  for (const adapter of adapters) {
    try {
      const result = await lookupOnce(adapter, { institutionCode: lookup.bank, accountNumber: lookup.number, country });
      if (!result.found) continue;
      const { name, verified } = resolveName(result.accountName, lookup.account_name);
      return { bank: lookup.bank, number: lookup.number, account_name: name, institution: institutionName(lookup.bank), name_verified: verified };
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
    }
  }
  throw new ApiError(404, "account_not_found", "The bank could not find that account.");
}

// Bank name lookups go through the bank's own switch and are sometimes slow; one timeout is asked again before the
// account is called unknown, since a timeout says nothing about whether the account exists.
async function lookupOnce(adapter: ProviderAdapter, check: Parameters<ProviderAdapter["verifyAccount"]>[0]) {
  try {
    return await adapter.verifyAccount(check);
  } catch (error) {
    if (error instanceof ProviderError && error.kind === "timeout") return adapter.verifyAccount(check);
    throw error;
  }
}

function view(config: Config, recipient: { id: string; institutionCode: string; accountCipher: Uint8Array; nameCipher: Uint8Array; createdAt: Date; own: boolean; isDefault: boolean }) {
  return {
    recipient_id: recipient.id,
    account_name: decrypt(recipient.nameCipher, config.dataKey),
    bank: { code: recipient.institutionCode, name: institutionName(recipient.institutionCode), logo_key: logoKeyFor(recipient.institutionCode) },
    account_last4: decrypt(recipient.accountCipher, config.dataKey).slice(-4),
    created_at: recipient.createdAt.toISOString(),
    own: recipient.own,
    default: recipient.isDefault,
  };
}

// A duplicate save returns the recipient already stored instead of making a second one.
export async function saveRecipient(unit: Unit, deps: RecipientDeps, userId: string, lookup: AccountLookup) {
  const verified = await verifyAccount(deps.adapters, lookup);
  const lookupHash = keyedHash(`${lookup.bank}:${lookup.number}`, deps.config.hashKey);
  return unit(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`recipient:${userId}`}, 0))`;
    const existing = await tx.recipient.findUnique({ where: { userId_lookupHash: { userId, lookupHash } } });
    if (existing?.savedAt && !existing.deletedAt) return { status: 200, body: view(deps.config, existing) };
    const saved = existing
      ? await tx.recipient.update({ where: { id: existing.id }, data: { savedAt: new Date(), deletedAt: null } })
      : await tx.recipient.create({
          data: {
            id: newId("rcp"),
            userId,
            institutionCode: lookup.bank,
            accountCipher: encrypt(lookup.number, deps.config.dataKey),
            nameCipher: encrypt(verified.account_name, deps.config.dataKey),
            lookupHash,
            savedAt: new Date(),
          },
        });
    return { status: 201, body: view(deps.config, saved) };
  });
}

export async function listRecipients(tx: Db, config: Config, userId: string) {
  const rows = await tx.recipient.findMany({ where: { userId, savedAt: { not: null }, deletedAt: null }, orderBy: [{ own: "desc" }, { savedAt: "desc" }] });
  return { items: rows.map((row) => view(config, row)) };
}

// Only one default: setting it clears the previous one. The user's own accounts are listed first.
export async function updateRecipient(tx: Db, config: Config, userId: string, recipientId: string, input: { own?: boolean; default?: boolean }) {
  const recipient = await tx.recipient.findFirst({ where: { id: recipientId, userId, savedAt: { not: null }, deletedAt: null } });
  if (!recipient) throw notFound("No such saved recipient.");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`recipient:${userId}`}, 0))`;
  if (input.default === true) await tx.recipient.updateMany({ where: { userId, isDefault: true, id: { not: recipientId } }, data: { isDefault: false } });
  const updated = await tx.recipient.update({
    where: { id: recipientId },
    data: { ...(input.own === undefined ? {} : { own: input.own }), ...(input.default === undefined ? {} : { isDefault: input.default }) },
  });
  return view(config, updated);
}

export async function deleteRecipient(tx: Db, userId: string, recipientId: string): Promise<void> {
  const removed = await tx.recipient.updateMany({ where: { id: recipientId, userId, savedAt: { not: null }, deletedAt: null }, data: { deletedAt: new Date(), isDefault: false } });
  if (removed.count === 0) throw notFound("No such saved recipient.");
}
