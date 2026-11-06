export type AccountType = "asset" | "liability" | "revenue" | "expense" | "contra";
export type Asset = "USDC" | "USDT";

export interface AccountRef {
  code: string;
  type: AccountType;
  asset: Asset;
  owner: string | null;
}

// Spec 6.2. Accounts are per asset and, where noted, per provider or vault holder. Fiat is never a balance.
const CHART = {
  sender_external: "contra",
  intents_in_flight: "asset",
  provider_escrow: "asset",
  recipient_paid: "contra",
  refund_in_flight: "liability",
  network_fees: "expense",
  fee_receivable: "asset",
  fee_wallet: "asset",
  fee_revenue: "revenue",
  vault_available: "liability",
  vault_reserved: "liability",
  bitnob_float: "asset",
  bitnob_reserved: "asset",
} as const satisfies Record<string, AccountType>;

export type AccountName = keyof typeof CHART;

export function account(name: AccountName, asset: Asset, owner: string | null = null): AccountRef {
  return { code: [name, owner, asset].filter(Boolean).join(":"), type: CHART[name], asset, owner };
}
