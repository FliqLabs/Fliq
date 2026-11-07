import { ProviderError, type ProviderOperation } from "../errors";
import type { Country, Institution, PayoutType, ProviderAdapter, ProviderId } from "../types";
import { INSTITUTION_TABLE, type InstitutionEntry } from "./table";

const LIST_TTL_MS = 10 * 60 * 1000;
const NOISE = new Set([
  "bank",
  "plc",
  "limited",
  "ltd",
  "the",
  "of",
  "nigeria",
  "kenya",
  "ghana",
  "mfb",
  "microfinance",
]);

export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !NOISE.has(word))
    .join("");
}

const byCode = new Map<string, InstitutionEntry>();
for (const entry of INSTITUTION_TABLE) {
  for (const code of [entry.code, ...(entry.aliases ?? [])]) {
    if (byCode.has(code)) throw new Error(`institution code ${code} is listed twice`);
    byCode.set(code, entry);
  }
}

export const findInstitution = (code: string): InstitutionEntry | undefined => byCode.get(code);

export const institutionsIn = (country: Country): InstitutionEntry[] =>
  INSTITUTION_TABLE.filter((entry) => entry.country === country);

// Institutions a provider lists that are not in the table keep the provider's code behind its id
// ("paycrest:ABOVNGPC"), so they can only ever be sent back to that provider.
const PROVIDER_SCOPED = /^([a-z]+):(.+)$/;
const learned = new Map<string, { name: string; type: PayoutType }>();

export function describeInstitution(
  code: string,
): { name: string; type: PayoutType; logoKey: string | null } | undefined {
  const entry = findInstitution(code);
  if (entry) return { name: entry.name, type: entry.type, logoKey: entry.logoKey };
  const seen = learned.get(code);
  return seen ? { ...seen, logoKey: null } : undefined;
}

function entryKeys(entry: InstitutionEntry): Set<string> {
  return new Set([entry.name, ...(entry.names ?? [])].map(nameKey));
}

function matchByName(country: Country, name: string): InstitutionEntry | undefined {
  const key = nameKey(name);
  return institutionsIn(country).find((entry) => entryKeys(entry).has(key));
}

function matchByProviderCode(
  provider: ProviderId,
  country: Country,
  code: string,
): InstitutionEntry | undefined {
  return institutionsIn(country).find((entry) => entry.providers[provider] === code);
}

// Every adapter speaks its provider's institution codes; the API speaks fliq codes. This wrapper translates
// both ways, so the same bank has one code in the app whichever provider pays it.
export function withInstitutionCodes<A extends ProviderAdapter>(adapter: A, now: () => number = Date.now): A {
  const lists = new Map<Country, { value: Promise<Institution[]>; expiresAt: number }>();

  function providerList(country: Country): Promise<Institution[]> {
    const cached = lists.get(country);
    if (cached && cached.expiresAt > now()) return cached.value;
    const value = adapter.institutions(country);
    lists.set(country, { value, expiresAt: now() + LIST_TTL_MS });
    value.catch(() => {
      if (lists.get(country)?.value === value) lists.delete(country);
    });
    return value;
  }

  function refuse(operation: ProviderOperation, kind: "rejected" | "not_supported"): never {
    throw new ProviderError(adapter.id, operation, kind, "institution not offered by this provider");
  }

  async function toProviderCode(
    code: string,
    country: Country,
    operation: ProviderOperation,
    kind: "rejected" | "not_supported",
  ): Promise<string> {
    const scoped = PROVIDER_SCOPED.exec(code);
    if (scoped) return scoped[1] === adapter.id && scoped[2] ? scoped[2] : refuse(operation, kind);
    const entry = findInstitution(code);
    if (!entry || entry.country !== country) return refuse(operation, kind);
    const known = entry.providers[adapter.id];
    if (known) return known;
    const keys = entryKeys(entry);
    const listed = (await providerList(country)).find((institution) => keys.has(nameKey(institution.name)));
    return listed ? listed.code : refuse(operation, kind);
  }

  function toFliq(country: Country, institution: Institution): Institution {
    const entry =
      matchByProviderCode(adapter.id, country, institution.code) ?? matchByName(country, institution.name);
    if (entry) return { code: entry.code, name: entry.name, type: entry.type };
    const code = `${adapter.id}:${institution.code}`;
    learned.set(code, { name: institution.name, type: institution.type });
    return { ...institution, code };
  }

  return {
    ...adapter,
    async institutions(country) {
      const translated = new Map<string, Institution>();
      for (const institution of await providerList(country)) {
        const fliq = toFliq(country, institution);
        if (!translated.has(fliq.code)) translated.set(fliq.code, fliq);
      }
      return [...translated.values()];
    },
    async verifyAccount(check) {
      const institutionCode = await toProviderCode(
        check.institutionCode,
        check.country,
        "verifyAccount",
        "not_supported",
      );
      return adapter.verifyAccount({ ...check, institutionCode });
    },
    // Refused before any provider call, so the order definitely does not exist and the payout can fail cleanly.
    async createOrder(request) {
      const { recipient, corridor } = request;
      const institutionCode = await toProviderCode(
        recipient.institutionCode,
        corridor.country,
        "createOrder",
        "rejected",
      );
      return adapter.createOrder({ ...request, recipient: { ...recipient, institutionCode } });
    },
  };
}
