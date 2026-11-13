// What apps/api uses to reach the private relayer. The relayer is never exposed publicly; the API authenticates
// the user first, then forwards with the shared RELAYER_AUTH_TOKEN.

const DEFAULT_TIMEOUT_MS = 45_000;

export type RelayResponse = {
  status: "succeeded" | "failed" | "pending";
  tx_hash: string;
  delegate_hash: string;
  sender_id: string;
  receiver_id: string;
  failures: string[];
};

export type AccountResponse = {
  status: "created" | "linked" | "pending";
  account_id: string;
  public_key: string;
  tx_hashes: string[];
  storage: Record<string, "registered" | "already_registered" | "not_deployed" | "pending">;
};

export type AgentDepositResponse = {
  status: "funded" | "already_funded" | "not_needed" | "pending";
  account_id: string;
  agent_id: string;
  yocto: string;
  tx_hash: string | null;
};

export class RelayerClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "RelayerClientError";
    this.status = status;
    this.code = code;
  }
}

export type RelayerClientOptions = {
  url: string;
  authToken: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export type RelayerClient = {
  relay(signedDelegateBase64: string): Promise<RelayResponse>;
  relayStatus(delegateHash: string): Promise<RelayResponse>;
  // registerStorage false is for agent accounts, which never hold a balance. Left out, the relayer registers.
  provisionAccount(accountId: string, publicKey: string, options?: { registerStorage?: boolean }): Promise<AccountResponse>;
  fundAgentDeposit(accountId: string, agentId: string): Promise<AgentDepositResponse>;
  health(): Promise<{ status: string }>;
};

export function createRelayerClient(options: RelayerClientOptions): RelayerClient {
  const doFetch = options.fetch ?? fetch;
  const base = options.url.replace(/\/+$/, "");

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${options.authToken}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      const cause = (error as { cause?: { code?: string } }).cause?.code ?? (error as Error).name;
      if ((error as Error).name === "TimeoutError") {
        throw new RelayerClientError(0, "relayer_timeout", "the relayer did not answer in time");
      }
      throw new RelayerClientError(0, "relayer_unreachable", `the relayer did not answer (${cause})`);
    }
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    if (!response.ok) {
      throw new RelayerClientError(
        response.status,
        payload?.error?.code ?? "relayer_error",
        payload?.error?.message ?? `HTTP ${response.status}`,
      );
    }
    return payload as T;
  }

  return {
    relay: (signedDelegate) => call("POST", "/v1/relays", { signed_delegate: signedDelegate }),
    relayStatus: (delegateHash) => call("GET", `/v1/relays/${encodeURIComponent(delegateHash)}`),
    provisionAccount: (accountId, publicKey, options) =>
      call("POST", "/v1/accounts", {
        account_id: accountId,
        public_key: publicKey,
        ...(options?.registerStorage === false ? { register_storage: false } : {}),
      }),
    fundAgentDeposit: (accountId, agentId) =>
      call("POST", "/v1/accounts/agent-deposit", { account_id: accountId, agent_id: agentId }),
    health: () => call("GET", "/health"),
  };
}
