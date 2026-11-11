
export type Money = {
  amount: string;
  currency: "NGN" | "KES" | "GHS" | "USD";
};

export type Agent = {
  agent_id: string;
  name: string;
  public_key: string;
  state: "pending" | "active" | "revoked";
  daily_cap: Money;
  per_payout_cap: Money;
  currencies: ("NGN" | "KES")[];
  saved_accounts_only: boolean;
  spent_today: Money;
  connected_at: string;
  expires_at: string;
};

export type AgentList = { agents: Agent[] };

export type User = {
  user_id: string;
  near_account: string | null;
  display_name: string | null;
  photo_url: string | null;
  occupation: string | null;
  vault: string | null;
  home_currency?: "NGN" | "KES";
  daily_limit?: Money;
  verified?: boolean;
};

export type Workspace = {
  workspace_id: string;
  name: string;
  use_case: "wallet" | "payroll" | "marketplace" | "agent" | "other";
  countries: string[];
  live_enabled: boolean;
};

export type WorkspaceCreated = {
  workspace: Workspace;
  sandbox_key: { key_id: string; key: string };
};

export type PayoutSummary = {
  payout_id: string;
  state: string;
  account_name: string;
  bank: { code: string; name: string };
  account_last4: string;
  amount: string;
  receive: number;
  currency: string;
  provider: string;
  created_at: string;
};

export type PayoutList = { items: PayoutSummary[]; next_cursor: string | null };
export type PayoutStats = {
  timezone: string;
  settled: { count: number; totals: { currency: string; amount: number }[] };
  median_seconds_to_bank: number | null;
  refused: { count: number; totals: { currency: string; amount: number }[] };
};
export type PublicRate = { rate: number };
export type LiveAccess = { live_enabled: boolean; kyb_status: string };
export type Usage = {
  totals: {
    requests: number;
    succeeded: number;
    failed: number;
    rate_limited: number;
    payouts_created: number;
  };
  rate_limit: { requests_per_minute: number; scope: string };
};
export type WebhookEndpoint = {
  endpoint_id: string;
  url: string;
  status: "active" | "failing" | "disabled";
  environment: "test" | "live";
};
export type WebhookEndpoints = { items: WebhookEndpoint[] };
export type WebhookDelivery = {
  delivery_id: string;
  event_type: string;
  payout_id: string | null;
  status: "pending" | "delivered" | "failed";
  response_status: number | null;
  attempts: number;
  created_at: string;
};
export type WebhookDeliveries = { items: WebhookDelivery[]; next_cursor: string | null };
export type Quote = {
  quote_id: string;
  amount: string;
  currency: string;
  receive: number;
  rate: number;
  provider: string;
  fees: { provider: number; network: number; total: number };
  expires_in: number;
};
export type Institution = {
  code: string;
  name: string;
  type: "bank" | "mobile_money";
  country: string;
};
export type VerifiedAccount = {
  bank: string;
  number: string;
  account_name: string;
  institution: string;
  name_verified: boolean;
};
export type Onboarding = {
  steps: { id: "create_test_payout" | "add_webhook" | "go_live"; done: boolean }[];
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export async function fliqApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/fliq/${path}`, {
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    credentials: "same-origin",
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.error?.message ?? "Something went wrong. Try again.";
    const code = typeof data?.error?.code === "string" ? data.error.code : undefined;
    const traceId = response.headers.get("x-trace-id");
    throw new ApiError(
      response.status >= 500 && traceId ? `${message} Reference: ${traceId}` : message,
      response.status,
      code,
    );
  }
  return data as T;
}
