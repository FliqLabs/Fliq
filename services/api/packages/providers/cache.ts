import { createHmac } from "node:crypto";
import type { AccountCheck, AccountVerification, Country, Institution, ProviderAdapter } from "./types";

export const INSTITUTIONS_TTL_MS = 24 * 60 * 60 * 1000;
export const VERIFY_TTL_MS = 10 * 60 * 1000;
const MAX_VERIFY_ENTRIES = 10_000;

export type CacheOptions = { hashKey: Buffer; now?: () => Date };

type Entry<T> = { value: Promise<T>; expiresAt: number };

// ARCH §12.1 and §9.2: institutions cached 24 h, account checks 10 min. Account checks are keyed by an
// HMAC so the plain account number is never held in memory as a key. Failures are never cached.
export function withCache<A extends ProviderAdapter>(adapter: A, options: CacheOptions): A {
  const now = () => (options.now ?? (() => new Date()))().getTime();
  const institutions = new Map<Country, Entry<Institution[]>>();
  const checks = new Map<string, Entry<AccountVerification>>();

  function remember<K, T>(
    store: Map<K, Entry<T>>,
    key: K,
    ttlMs: number,
    load: () => Promise<T>,
  ): Promise<T> {
    const cached = store.get(key);
    if (cached && cached.expiresAt > now()) return cached.value;
    const value = load();
    store.set(key, { value, expiresAt: now() + ttlMs });
    value.catch(() => {
      if (store.get(key)?.value === value) store.delete(key);
    });
    return value;
  }

  function checkKey(check: AccountCheck): string {
    const material = `${adapter.id}:${check.country}:${check.institutionCode}:${check.accountNumber}`;
    return createHmac("sha256", options.hashKey).update(material).digest("hex");
  }

  function trimChecks(): void {
    for (const key of checks.keys()) {
      if (checks.size <= MAX_VERIFY_ENTRIES) return;
      checks.delete(key);
    }
  }

  return {
    ...adapter,
    institutions: (country) =>
      remember(institutions, country, INSTITUTIONS_TTL_MS, () => adapter.institutions(country)),
    verifyAccount: (check) => {
      const result = remember(checks, checkKey(check), VERIFY_TTL_MS, () => adapter.verifyAccount(check));
      trimChecks();
      return result;
    },
  };
}
