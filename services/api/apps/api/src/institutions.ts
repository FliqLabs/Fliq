import type { Country } from "../../../packages/providers/types.js";

// Seed list until Collins supplies institution metadata. logoKey names the logo asset the apps ship.
export interface Institution {
  code: string;
  name: string;
  country: "ng" | "ke";
  kind: "bank" | "mobile_money";
  logoKey: string;
}

export const INSTITUTIONS: Institution[] = [
  { code: "058", name: "GTBank", country: "ng", kind: "bank", logoKey: "gtbank" },
  { code: "044", name: "Access Bank", country: "ng", kind: "bank", logoKey: "access-bank" },
  { code: "999992", name: "OPay", country: "ng", kind: "mobile_money", logoKey: "opay" },
  { code: "mpesa", name: "M-Pesa", country: "ke", kind: "mobile_money", logoKey: "mpesa" },
];

export const institutionName = (code: string): string => INSTITUTIONS.find((item) => item.code === code)?.name ?? code;
export const logoKeyFor = (code: string): string | null => INSTITUTIONS.find((item) => item.code === code)?.logoKey ?? null;

export const COUNTRY_CODE: Record<string, Country> = { ng: "NG", ke: "KE", gh: "GH", id: "ID", ph: "PH" };
