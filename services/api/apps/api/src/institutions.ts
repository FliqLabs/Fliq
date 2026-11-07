import { describeInstitution } from "../../../packages/providers/institutions/translate.js";
import type { Country, PayoutType } from "../../../packages/providers/types.js";

// Offered even when no enabled provider lists them, so the sandbox shows the institutions in spec/fixtures.
export const FEATURED_CODES: readonly string[] = ["058", "044", "999992", "mpesa"];

export const institutionName = (code: string): string => describeInstitution(code)?.name ?? code;
export const logoKeyFor = (code: string): string | null => describeInstitution(code)?.logoKey ?? null;
export const institutionType = (code: string): PayoutType => describeInstitution(code)?.type ?? "bank";

export const COUNTRY_CODE: Record<string, Country> = { ng: "NG", ke: "KE", gh: "GH", id: "ID", ph: "PH" };
