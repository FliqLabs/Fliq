export type PayoutState =
  | "created"
  | "provider_timeout"
  | "awaiting_recon"
  | "awaiting_deposit"
  | "deposit_seen"
  | "routing"
  | "with_provider"
  | "paying_out"
  | "settled"
  | "refunding"
  | "refused"
  | "refunded"
  | "expired"
  | "failed"
  | "not_received";

export type Payout = {
  payout_id: string;
  state: PayoutState;
  account_name: string;
  account: { bank: string; number: string };
  amount: string;
  receive: number;
  currency: string;
  rate: number;
  fees: { provider: number; network: number; total: number };
  provider: string;
  deposit: { chain: string; address: string; amount: string };
  provider_order?: string | null;
  vault_receipt?: string | null;
  bank_reference?: string | null;
  seconds?: number | null;
  history: { state: PayoutState; at: string }[];
};

export function formatLocalAmount(amount: number, currency: string) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function stateLabel(state: string) {
  return state.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}
