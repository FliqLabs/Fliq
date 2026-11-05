import { RpcError } from "./evm-rpc";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_PAGE = 1_000;

export type SolanaCommitment = "confirmed" | "finalized";

export type SignatureInfo = { signature: string; slot: bigint; failed: boolean };

export type TokenCredit = { mint: string; amount: bigint; from: string; slot: bigint; at: Date | null };

export type SignaturePage = { until?: string; before?: string; limit: number };

export interface SolanaRpc {
  // Newest first, as the RPC returns them.
  signatures(address: string, page: SignaturePage): Promise<SignatureInfo[]>;
  // What the token account gained in this transaction, or null if it gained nothing or the transaction is unknown.
  tokenCredit(signature: string, tokenAccount: string): Promise<TokenCredit | null>;
}

export type SolanaRpcOptions = {
  url: string;
  commitment: SolanaCommitment;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

type TokenBalance = { account: string; mint: string; owner: string | undefined; amount: bigint };

export function createSolanaRpc(options: SolanaRpcOptions): SolanaRpc {
  const doFetch = options.fetch ?? fetch;
  let id = 0;

  async function call(method: string, params: unknown[]): Promise<unknown> {
    id += 1;
    let response: Response;
    try {
      response = await doFetch(options.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch {
      throw new RpcError(method, "unavailable", "no response");
    }
    if (!response.ok) throw new RpcError(method, "unavailable", `HTTP ${response.status}`);
    const body = (await response.json().catch(() => null)) as {
      result?: unknown;
      error?: { message?: unknown };
    } | null;
    if (!body) throw new RpcError(method, "invalid_response", "body is not JSON");
    if (body.error)
      throw new RpcError(method, "rpc_error", String(body.error.message ?? "error").slice(0, 200));
    return body.result;
  }

  return {
    async signatures(address, page) {
      const config = {
        commitment: options.commitment,
        limit: Math.min(page.limit, MAX_PAGE),
        ...(page.until ? { until: page.until } : {}),
        ...(page.before ? { before: page.before } : {}),
      };
      const result = await call("getSignaturesForAddress", [address, config]);
      if (!Array.isArray(result))
        throw new RpcError("getSignaturesForAddress", "invalid_response", "expected an array");
      return result.map((entry) => {
        const info = record("getSignaturesForAddress", entry);
        return {
          signature: text("getSignaturesForAddress", info.signature),
          slot: slot("getSignaturesForAddress", info.slot),
          failed: info.err !== null && info.err !== undefined,
        };
      });
    },

    async tokenCredit(signature, tokenAccount) {
      const params = [
        signature,
        { encoding: "jsonParsed", commitment: options.commitment, maxSupportedTransactionVersion: 0 },
      ];
      const result = await call("getTransaction", params);
      if (result === null) return null;
      const tx = record("getTransaction", result);
      const meta = record("getTransaction", tx.meta);
      if (meta.err !== null && meta.err !== undefined) return null;
      const keys = accountKeys(tx, meta);
      const pre = balances(meta.preTokenBalances, keys);
      const post = balances(meta.postTokenBalances, keys);
      const after = post.find((balance) => balance.account === tokenAccount);
      if (!after) return null;
      const before = pre.find((balance) => balance.account === tokenAccount)?.amount ?? 0n;
      if (after.amount <= before) return null;
      return {
        mint: after.mint,
        amount: after.amount - before,
        from: sender(pre, post, after.mint, tokenAccount),
        slot: slot("getTransaction", tx.slot),
        at: typeof tx.blockTime === "number" ? new Date(tx.blockTime * 1000) : null,
      };
    },
  };
}

// jsonParsed lists every account, including address-table lookups; the plain form needs loadedAddresses appended.
function accountKeys(tx: Record<string, unknown>, meta: Record<string, unknown>): string[] {
  const message = record("getTransaction", record("getTransaction", tx.transaction).message);
  const listed = message.accountKeys;
  if (!Array.isArray(listed)) throw new RpcError("getTransaction", "invalid_response", "accountKeys missing");
  const keys = listed.map((key) =>
    typeof key === "string" ? key : text("getTransaction", record("getTransaction", key).pubkey),
  );
  if (listed.every((key) => typeof key !== "string")) return keys;
  const loaded = (meta.loadedAddresses ?? {}) as { writable?: unknown; readonly?: unknown };
  const extra = [loaded.writable, loaded.readonly].flatMap((list) =>
    Array.isArray(list) ? list.map(String) : [],
  );
  return [...keys, ...extra];
}

function balances(value: unknown, keys: readonly string[]): TokenBalance[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value))
    throw new RpcError("getTransaction", "invalid_response", "token balances must be a list");
  return value.map((entry) => {
    const balance = record("getTransaction", entry);
    const index = balance.accountIndex;
    const account = typeof index === "number" ? keys[index] : undefined;
    if (!account)
      throw new RpcError("getTransaction", "invalid_response", "token balance account index out of range");
    const amount = record("getTransaction", balance.uiTokenAmount).amount;
    if (typeof amount !== "string" || !/^\d+$/.test(amount)) {
      throw new RpcError("getTransaction", "invalid_response", "token amount must be an integer string");
    }
    return {
      account,
      mint: text("getTransaction", balance.mint),
      owner: typeof balance.owner === "string" ? balance.owner : undefined,
      amount: BigInt(amount),
    };
  });
}

// The sender is the owner of the account of the same mint that lost tokens; a multi-party transaction reports the first.
function sender(pre: TokenBalance[], post: TokenBalance[], mint: string, tokenAccount: string): string {
  for (const before of pre) {
    if (before.mint !== mint || before.account === tokenAccount) continue;
    const after = post.find((balance) => balance.account === before.account)?.amount ?? 0n;
    if (after < before.amount) return before.owner ?? before.account;
  }
  return "unknown";
}

function record(method: string, value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RpcError(method, "invalid_response", "expected an object");
  }
  return value as Record<string, unknown>;
}

function text(method: string, value: unknown): string {
  if (typeof value !== "string" || value === "")
    throw new RpcError(method, "invalid_response", "expected a string");
  return value;
}

function slot(method: string, value: unknown): bigint {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new RpcError(method, "invalid_response", "slot must be a whole number");
  }
  return BigInt(value);
}
