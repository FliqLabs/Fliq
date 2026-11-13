const DEFAULT_TIMEOUT_MS = 10_000;
const SEND_TIMEOUT_MS = 30_000;
const MAX_DETAIL = 300;
const SEND_WAIT = "EXECUTED_OPTIMISTIC";

export type NearRpcErrorKind =
  | "unavailable"
  | "timeout"
  | "not_found"
  | "invalid_transaction"
  | "rpc_error"
  | "invalid_response";

// RPC URLs can carry provider keys, so they never appear in a message.
export class NearRpcError extends Error {
  readonly kind: NearRpcErrorKind;
  readonly causeName: string | undefined;

  constructor(method: string, kind: NearRpcErrorKind, detail: string, causeName?: string) {
    super(`${method} ${kind}: ${detail.slice(0, MAX_DETAIL)}`);
    this.name = "NearRpcError";
    this.kind = kind;
    this.causeName = causeName;
  }

  // The request may or may not have reached the chain.
  get outcomeUnknown(): boolean {
    return this.kind === "unavailable" || this.kind === "timeout";
  }
}

export type AccessKeyView =
  | { nonce: bigint; permission: "FullAccess" }
  | { nonce: bigint; permission: { receiverId: string; methodNames: string[]; allowance: bigint | null } };

export type AccountView = { amount: bigint; storageUsage: number; codeHash: string };

export type FinalBlock = { hash: string; height: bigint };

export type ExecutionStatus = "succeeded" | "failed";

export type TxOutcome = {
  txHash: string;
  status: ExecutionStatus;
  failures: string[];
  gasBurnt: bigint;
};

export interface NearRpc {
  accessKey(accountId: string, publicKey: string): Promise<AccessKeyView | null>;
  account(accountId: string): Promise<AccountView | null>;
  callView(contractId: string, method: string, args: unknown): Promise<unknown>;
  finalBlock(): Promise<FinalBlock>;
  // Waits until every receipt has executed (EXECUTED_OPTIMISTIC), not for finality, which costs about two more
  // seconds and tells the caller nothing new: a failed receipt is already in the outcome. Throws NearRpcError with
  // outcomeUnknown on a timeout: look the hash up later.
  sendTransaction(signedTxBase64: string): Promise<TxOutcome>;
  transactionStatus(txHash: string, senderId: string): Promise<TxOutcome | null>;
}

export type NearRpcOptions = { url: string; fetch?: typeof fetch; timeoutMs?: number };

export function createNearRpc(options: NearRpcOptions): NearRpc {
  const doFetch = options.fetch ?? fetch;
  let id = 0;

  async function call(method: string, params: unknown, timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS) {
    id += 1;
    let response: Response;
    try {
      response = await doFetch(options.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new NearRpcError(
        method,
        timedOut ? "timeout" : "unavailable",
        timedOut ? "no response in time" : "no response",
      );
    }
    if (response.status >= 500 || response.status === 429) {
      throw new NearRpcError(method, "unavailable", `HTTP ${response.status}`);
    }
    const body = (await response.json().catch(() => null)) as { result?: unknown; error?: unknown } | null;
    if (!body) throw new NearRpcError(method, "invalid_response", "body is not JSON");
    if (body.error !== undefined) throw rpcFailure(method, body.error);
    if (isRecord(body.result) && typeof body.result.error === "string") {
      throw new NearRpcError(
        method,
        notFound(body.result.error) ? "not_found" : "rpc_error",
        body.result.error,
      );
    }
    return body.result;
  }

  async function query(params: Record<string, unknown>) {
    try {
      // Reads follow sends that answer on execution, so they read the same optimistic head. A "final" read made
      // straight after would miss the transaction: a stale nonce, or an account that looks not yet created.
      return record("query", await call("query", { finality: "optimistic", ...params }));
    } catch (error) {
      if (error instanceof NearRpcError && error.kind === "not_found") return null;
      throw error;
    }
  }

  return {
    async accessKey(accountId, publicKey) {
      const view = await query({
        request_type: "view_access_key",
        account_id: accountId,
        public_key: publicKey,
      });
      return view ? parseAccessKey(view) : null;
    },

    async account(accountId) {
      const view = await query({ request_type: "view_account", account_id: accountId });
      if (!view) return null;
      return {
        amount: integer("view_account", view.amount),
        storageUsage: Number(integer("view_account", view.storage_usage)),
        codeHash: text("view_account", view.code_hash),
      };
    },

    async callView(contractId, method, args) {
      const view = await query({
        request_type: "call_function",
        account_id: contractId,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      });
      if (!view || !Array.isArray(view.result))
        throw new NearRpcError("call_function", "invalid_response", "no result");
      const text = Buffer.from(view.result as number[]).toString("utf8");
      return text === "" ? null : JSON.parse(text);
    },

    async finalBlock() {
      const block = record("block", await call("block", { finality: "final" }));
      const header = record("block", block.header);
      return { hash: text("block", header.hash), height: integer("block", header.height) };
    },

    async sendTransaction(signedTxBase64) {
      const result = await call(
        "send_tx",
        { signed_tx_base64: signedTxBase64, wait_until: SEND_WAIT },
        SEND_TIMEOUT_MS,
      );
      return parseOutcome(result);
    },

    async transactionStatus(txHash, senderId) {
      try {
        const result = await call("tx", {
          tx_hash: txHash,
          sender_account_id: senderId,
          wait_until: SEND_WAIT,
        });
        return parseOutcome(result);
      } catch (error) {
        if (error instanceof NearRpcError && error.causeName === "UNKNOWN_TRANSACTION") return null;
        throw error;
      }
    },
  };
}

// A meta transaction runs the user's actions in their own receipts, so a failure there must be read from
// receipts_outcome; the transaction itself can succeed while the delegated call fails.
export function parseOutcome(value: unknown): TxOutcome {
  const result = record("send_tx", value);
  const transactionOutcome = record("send_tx", result.transaction_outcome);
  const receipts = Array.isArray(result.receipts_outcome) ? result.receipts_outcome : [];
  const failures: string[] = [];
  let gasBurnt = integer("send_tx", record("send_tx", transactionOutcome.outcome).gas_burnt);
  for (const receipt of receipts) {
    const outcome = record("send_tx", record("send_tx", receipt).outcome);
    gasBurnt += integer("send_tx", outcome.gas_burnt);
    const failure = failureOf(outcome.status);
    if (failure) failures.push(failure);
  }
  const topLevel = failureOf(result.status);
  if (topLevel && !failures.includes(topLevel)) failures.unshift(topLevel);
  return {
    txHash: text("send_tx", transactionOutcome.id),
    status: failures.length === 0 ? "succeeded" : "failed",
    failures,
    gasBurnt,
  };
}

function failureOf(status: unknown): string | null {
  if (!isRecord(status) || status.Failure === undefined) return null;
  return JSON.stringify(status.Failure).slice(0, MAX_DETAIL);
}

function parseAccessKey(view: Record<string, unknown>): AccessKeyView {
  const nonce = integer("view_access_key", view.nonce);
  if (view.permission === "FullAccess") return { nonce, permission: "FullAccess" };
  const functionCall = record("view_access_key", record("view_access_key", view.permission).FunctionCall);
  const methods = functionCall.method_names;
  if (!Array.isArray(methods))
    throw new NearRpcError("view_access_key", "invalid_response", "method_names missing");
  return {
    nonce,
    permission: {
      receiverId: text("view_access_key", functionCall.receiver_id),
      methodNames: methods.map((method) => text("view_access_key", method)),
      allowance: functionCall.allowance === null ? null : integer("view_access_key", functionCall.allowance),
    },
  };
}

function rpcFailure(method: string, error: unknown): NearRpcError {
  const details = isRecord(error) ? error : {};
  const cause = isRecord(details.cause) ? details.cause : {};
  const causeName = typeof cause.name === "string" ? cause.name : undefined;
  const detail = JSON.stringify(cause.info ?? details.data ?? details.message ?? "error");
  if (causeName === "TIMEOUT_ERROR") return new NearRpcError(method, "timeout", detail, causeName);
  if (causeName === "INVALID_TRANSACTION")
    return new NearRpcError(method, "invalid_transaction", detail, causeName);
  if (causeName && notFound(causeName)) return new NearRpcError(method, "not_found", detail, causeName);
  return new NearRpcError(method, "rpc_error", detail, causeName);
}

function notFound(message: string): boolean {
  return /UNKNOWN_ACCOUNT|UNKNOWN_ACCESS_KEY|does not exist/i.test(message);
}

function record(method: string, value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new NearRpcError(method, "invalid_response", "expected an object");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(method: string, value: unknown): string {
  if (typeof value !== "string" || value === "")
    throw new NearRpcError(method, "invalid_response", "expected a string");
  return value;
}

function integer(method: string, value: unknown): bigint {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  throw new NearRpcError(method, "invalid_response", "expected a non-negative integer");
}
