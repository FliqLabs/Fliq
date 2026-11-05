export type User = {
  user_id: string;
  near_account: string | null;
  display_name: string | null;
  photo_url: string | null;
  occupation: string | null;
  vault: string | null;
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
export type Onboarding = {
  steps: { id: "create_test_payout" | "add_webhook" | "go_live"; done: boolean }[];
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
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
    const traceId = response.headers.get("x-trace-id");
    throw new ApiError(
      response.status >= 500 && traceId ? `${message} Reference: ${traceId}` : message,
      response.status,
    );
  }
  return data as T;
}
