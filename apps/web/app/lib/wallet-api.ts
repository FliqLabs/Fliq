import { fliqApi, type Agent, type Money, type User } from "./fliq-api";
import type { RelayResult, SignStep } from "./near-delegate";

export type ProviderId = "paycrest" | "busha" | "fonbnk" | "bitnob" | "transfi" | "mock";
export type ProviderStatus = "live" | "stale" | "paused";

export type VaultBalance = { account: string; available: string; reserved: string; total: string; in_sync: boolean };

export type ActivityItem = {
  activity_id: string;
  kind: "payout" | "deposit" | "transfer_in" | "transfer_out" | "refused";
  status: "pending" | "paid" | "received" | "sent" | "refunded" | "refused" | "failed" | "expired";
  at: string;
  party: {
    name: string;
    near_account: string | null;
    institution: string | null;
    account_last4: string | null;
    photo_url: string | null;
  };
  provider: ProviderId | null;
  agent: { agent_id: string; name: string } | null;
  local: Money | null;
  usd: string | null;
  token: string | null;
  seconds: number | null;
  reason:
    | "over_daily_cap"
    | "over_per_payout_cap"
    | "corridor_not_allowed"
    | "not_saved_account"
    | "provider_failed"
    | "expired"
    | null;
  ref_id: string;
};
export type ActivityList = { items: ActivityItem[]; next_cursor: string | null };
export type ActivityFilter = "all" | "mine" | "agents";

export type ProviderRate = {
  provider: ProviderId;
  status: ProviderStatus;
  rate: number | null;
  rate_before_fees: number | null;
  fee: number | null;
  receive: number | null;
  eta_seconds: number | null;
  on_time_percent: number | null;
  updated_at: string | null;
  not_offered_reason: string | null;
};
export type RateBoard = {
  token: string;
  currency: string;
  amount: string;
  best: ProviderId | null;
  fetched_at: string;
  providers: ProviderRate[];
};

export type Route = {
  provider: ProviderId;
  status: ProviderStatus;
  rate: number | null;
  age_seconds?: number;
  routed?: boolean;
  receive?: number;
  fee?: number;
  eta_seconds?: number;
  on_time_percent?: number;
  less_than_best?: number;
  via_intents?: boolean;
  not_offered_reason?: string | null;
};
export type RankedQuote = {
  quote_id: string;
  token: string;
  currency: string;
  amount: string;
  rate_before_fees: number;
  fees: { provider: number; network: number; total: number };
  rate: number;
  receive: number;
  provider: ProviderId;
  best_of: number;
  routes: Route[];
  expires_in: number;
  eta_seconds?: number;
  saving_vs_next?: number;
};

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
  | "refunded"
  | "expired"
  | "failed"
  | "refused"
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
  provider: ProviderId;
  deposit: { chain: string; address: string; amount: string };
  provider_order?: string | null;
  vault_receipt?: string | null;
  bank_reference?: string | null;
  seconds?: number | null;
  history: { state: PayoutState; at: string }[];
  agent?: { agent_id: string; name: string } | null;
  failure?: { stage: string; code: string | null; at: string } | null;
  refund?: { amount: string; to: "vault" | "sender"; at: string; tx: string | null } | null;
  settlement_name?: string | null;
};

export type Refusal = {
  error: { code: string; message: string };
  attempted: number;
  per_payout_cap: number;
  daily_cap: number;
  used_today: number;
};

export type Institution = {
  code: string;
  name: string;
  type: "bank" | "mobile_money";
  country: string;
  logo_key: string | null;
};
export type VerifiedAccount = {
  bank: string;
  number: string;
  account_name: string;
  institution: string;
};
export type Recipient = {
  recipient_id: string;
  account_name: string;
  bank: { code: string; name: string; logo_key: string | null };
  account_last4: string;
  created_at: string;
  own?: boolean;
  default?: boolean;
};
export type Person = {
  near_account: string;
  display_name: string | null;
  photo_url: string | null;
  member_since: string;
  last_paid_at?: string | null;
};

export type DepositSource = {
  token: "usdc" | "usdt" | "btc";
  chain: "base" | "solana" | "tron" | "arbitrum" | "ethereum" | "polygon" | "bitcoin" | "near";
  group: "dollars" | "bitcoin" | "near";
  minimum: string;
  eta_seconds: number;
  direct: boolean;
  available: boolean;
  address: string | null;
};
export type DepositEstimate = {
  token: DepositSource["token"];
  chain: DepositSource["chain"];
  amount: string;
  minimum: string;
  fee: string;
  lands: string;
  eta_seconds: number;
};
export type VaultDeposit = {
  deposit_id: string;
  state: "waiting" | "seen" | "underpaid" | "bridging" | "landed" | "refunded" | "expired" | "failed";
  token: DepositSource["token"];
  chain: DepositSource["chain"];
  address: string;
  memo: string | null;
  amount: string;
  minimum: string;
  fee: string;
  lands: string;
  eta_seconds: number;
  reserved_until: string;
  received: string | null;
  landed: string | null;
  refunded: string | null;
  seconds: number | null;
  created_at: string;
};

export type PaymentRequest = {
  request_id: string;
  code: string;
  link: string;
  amount: string;
  note: string;
  state: "open" | "paid" | "cancelled";
  cash_out_on_arrival: boolean;
  created_at: string;
  paid: { paid_at: string; payer: string | null; token: string; chain: string; landed: string } | null;
};

export type AgentChange = { agent: Agent; steps: SignStep[] };
export type Passkey = { passkey_id: string; transports: string[]; created_at: string; last_used_at: string | null };
export type DeviceSession = {
  session_id: string;
  device: string;
  current: boolean;
  created_at: string;
  last_active_at: string;
};
export type NotificationSettings = {
  received: boolean;
  payout_paid: boolean;
  payout_refunded: boolean;
  agent_paid: boolean;
  agent_refused: boolean;
  cap_almost_reached: boolean;
  rate_alert: { enabled: boolean; currency: "NGN" | "KES"; above: number | null };
  weekly_summary: boolean;
};

export type { Agent, Money, RelayResult, SignStep, User };

const json = (body: unknown, method = "POST"): RequestInit => ({ method, body: JSON.stringify(body) });

export const walletApi = {
  me: () => fliqApi<User>("me"),
  updateMe: (patch: Partial<Pick<User, "display_name" | "occupation">> & { home_currency?: "NGN" | "KES" }) =>
    fliqApi<User>("me", json(patch, "PATCH")),
  vault: () => fliqApi<VaultBalance>("vault"),
  activity: (filter: ActivityFilter, cursor?: string | null) =>
    fliqApi<ActivityList>(
      `activity?limit=25${filter === "all" ? "" : `&filter=${filter}`}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
  rateBoard: (currency: string) => fliqApi<RateBoard>(`rates/usdc/${currency.toLowerCase()}/providers`),
  recipients: () => fliqApi<{ items: Recipient[] }>("recipients"),
  saveRecipient: (input: { bank: string; number: string; country: string }) =>
    fliqApi<Recipient>("recipients", json(input)),
  deleteRecipient: (id: string) => fliqApi<void>(`recipients/${encodeURIComponent(id)}`, { method: "DELETE" }),
  institutions: (country: string) => fliqApi<{ items: Institution[] }>(`institutions?country=${country}`),
  verifyAccount: (input: { bank: string; number: string; country: string }) =>
    fliqApi<VerifiedAccount>("accounts/verify", json(input)),
  recentPeople: () => fliqApi<{ items: Person[] }>("people/recent"),
  person: (name: string) => fliqApi<Person>(`people/${encodeURIComponent(name)}`),
  quote: (input: { currency: string; amount: string; payout_type: "bank" | "mobile_money" }) =>
    fliqApi<RankedQuote>("quotes", json({ token: "usdc", ...input, currency: input.currency.toLowerCase() })),
  createPayout: (input: { quote_id: string; account: { bank: string; number: string } }, idempotencyKey: string) =>
    fliqApi<Payout>("payouts", { ...json(input), headers: { "Idempotency-Key": idempotencyKey } }),
  payout: (id: string) => fliqApi<Payout>(`payouts/${encodeURIComponent(id)}`),
  relay: (signedDelegate: string) => fliqApi<RelayResult>("relays", json({ signed_delegate: signedDelegate })),
  relayStatus: (hash: string) => fliqApi<RelayResult>(`relays/${encodeURIComponent(hash)}`),
  depositSources: () => fliqApi<{ sources: DepositSource[] }>("deposits/sources"),
  depositEstimate: (source: DepositSource, amount: string) =>
    fliqApi<DepositEstimate>(`deposits/estimate?token=${source.token}&chain=${source.chain}&amount=${amount}`),
  createDeposit: (source: DepositSource, amount: string) =>
    fliqApi<VaultDeposit>("deposits", json({ token: source.token, chain: source.chain, amount })),
  deposit: (id: string) => fliqApi<VaultDeposit>(`deposits/${encodeURIComponent(id)}`),
  requests: () => fliqApi<{ items: PaymentRequest[] }>("requests"),
  createRequest: (input: { amount: string; note: string; cash_out_on_arrival: boolean }) =>
    fliqApi<PaymentRequest>("requests", json(input)),
  cancelRequest: (id: string) => fliqApi<PaymentRequest>(`requests/${encodeURIComponent(id)}`, { method: "DELETE" }),
  agents: () => fliqApi<{ agents: Agent[] }>("agents"),
  connectAgent: (input: {
    name: string;
    public_key: string;
    daily_cap: Money;
    per_payout_cap: Money;
    currencies: ("NGN" | "KES")[];
    saved_accounts_only: boolean;
  }) => fliqApi<AgentChange>("agents", json(input)),
  updateAgent: (
    id: string,
    limits: { daily_cap: Money; per_payout_cap: Money; currencies: ("NGN" | "KES")[]; saved_accounts_only: boolean },
  ) => fliqApi<AgentChange>(`agents/${encodeURIComponent(id)}`, json(limits, "PATCH")),
  revokeAgent: (id: string) => fliqApi<AgentChange>(`agents/${encodeURIComponent(id)}`, { method: "DELETE" }),
  passkeys: () => fliqApi<{ items: Passkey[] }>("passkeys"),
  sessions: () => fliqApi<{ items: DeviceSession[] }>("sessions"),
  revokeSession: (id: string) => fliqApi<void>(`sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  notificationSettings: () => fliqApi<NotificationSettings>("me/notification-settings"),
  saveNotificationSettings: (settings: NotificationSettings) =>
    fliqApi<NotificationSettings>("me/notification-settings", json(settings, "PUT")),
};
