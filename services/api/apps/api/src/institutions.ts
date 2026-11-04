// Seed list until Collins supplies institution metadata (logo keys included).
export interface Institution {
  code: string;
  name: string;
  country: "ng" | "ke";
  kind: "bank" | "mobile_money";
}

export const INSTITUTIONS: Institution[] = [
  { code: "058", name: "GTBank", country: "ng", kind: "bank" },
  { code: "044", name: "Access Bank", country: "ng", kind: "bank" },
  { code: "999992", name: "OPay", country: "ng", kind: "mobile_money" },
  { code: "mpesa", name: "M-Pesa", country: "ke", kind: "mobile_money" },
];

export const institutionName = (code: string): string => INSTITUTIONS.find((item) => item.code === code)?.name ?? code;
