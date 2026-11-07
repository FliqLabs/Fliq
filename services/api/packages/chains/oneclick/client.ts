import {
  ONECLICK_STATUSES,
  OneClickError,
  type DepositSubmission,
  type OneClickExecution,
  type OneClickOperation,
  type OneClickQuote,
  type OneClickStatus,
  type OneClickToken,
  type QuoteInput,
} from "./types";

export const DEFAULT_TIMEOUT_MS: Record<OneClickOperation, number> = {
  tokens: 10_000,
  quote: 1_500,
  submitDeposit: 10_000,
  status: 5_000,
};

// A repeated non-dry quote creates another deposit address and spends the routing budget, so quotes are not retried.
const ATTEMPTS: Record<OneClickOperation, number> = { tokens: 3, quote: 1, submitDeposit: 3, status: 3 };
const BACKOFF_MS = 200;
const MAX_MESSAGE_LENGTH = 200;

export type OneClickClientOptions = {
  baseUrl: string;
  apiKey: string | undefined;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

export type CallOptions = { signal?: AbortSignal; timeoutMs?: number };

export type OneClickClient = {
  tokens(options?: CallOptions): Promise<OneClickToken[]>;
  quote(input: QuoteInput, options?: CallOptions): Promise<OneClickQuote>;
  submitDeposit(submission: DepositSubmission, options?: CallOptions): Promise<OneClickExecution>;
  status(depositAddress: string, depositMemo?: string, options?: CallOptions): Promise<OneClickExecution>;
};

type ApiRequest = {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
};

export function createOneClickClient(options: OneClickClientOptions): OneClickClient {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const baseUrl = options.baseUrl.replace(/\/+$/, "");

  async function call(
    operation: OneClickOperation,
    request: ApiRequest,
    perCall: CallOptions = {},
  ): Promise<unknown> {
    const attempts = ATTEMPTS[operation];
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await once(operation, request, perCall);
      } catch (error) {
        if (!(error instanceof OneClickError) || !error.transient || attempt >= attempts) throw error;
        await sleep(BACKOFF_MS * attempt);
      }
    }
  }

  async function once(
    operation: OneClickOperation,
    request: ApiRequest,
    perCall: CallOptions,
  ): Promise<unknown> {
    if (perCall.signal?.aborted) throw new OneClickError(operation, "cancelled", "aborted by caller");
    const timeout = AbortSignal.timeout(perCall.timeoutMs ?? DEFAULT_TIMEOUT_MS[operation]);
    const signal = perCall.signal ? AbortSignal.any([perCall.signal, timeout]) : timeout;
    const headers: Record<string, string> = { accept: "application/json" };
    if (request.body !== undefined) headers["content-type"] = "application/json";
    if (options.apiKey) headers["x-api-key"] = options.apiKey;

    let response: Response;
    try {
      response = await doFetch(url(request), {
        method: request.method,
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal,
      });
    } catch {
      if (perCall.signal?.aborted) throw new OneClickError(operation, "cancelled", "aborted by caller");
      if (timeout.aborted) throw new OneClickError(operation, "timeout", "no response in time");
      throw new OneClickError(operation, "unavailable", "network error");
    }
    return read(operation, response);
  }

  async function read(operation: OneClickOperation, response: Response): Promise<unknown> {
    const text = await response.text().catch(() => null);
    if (text === null)
      throw new OneClickError(operation, "unavailable", "response body interrupted", response.status);
    if (response.status === 401 || response.status === 403) {
      throw new OneClickError(operation, "unauthorized", "API key refused", response.status);
    }
    if (response.status === 429 || response.status >= 500) {
      throw new OneClickError(operation, "unavailable", `HTTP ${response.status}`, response.status);
    }
    if (!response.ok) throw new OneClickError(operation, "rejected", errorMessage(text), response.status);
    try {
      return JSON.parse(text);
    } catch {
      throw new OneClickError(operation, "invalid_response", "body is not JSON", response.status);
    }
  }

  function url(request: ApiRequest): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(request.query ?? {}))
      if (value !== undefined) query.set(key, value);
    const search = query.size > 0 ? `?${query}` : "";
    return `${baseUrl}${request.path}${search}`;
  }

  return {
    async tokens(callOptions) {
      const body = await call("tokens", { method: "GET", path: "/v0/tokens" }, callOptions);
      if (!Array.isArray(body)) throw invalid("tokens", "expected an array");
      return body.map((token) => parseToken(token));
    },
    async quote(input, callOptions) {
      const body = await call(
        "quote",
        { method: "POST", path: "/v0/quote", body: quoteBody(input) },
        callOptions,
      );
      return parseQuote(body, input.dry);
    },
    async submitDeposit(submission, callOptions) {
      const body = await call(
        "submitDeposit",
        { method: "POST", path: "/v0/deposit/submit", body: submission },
        callOptions,
      );
      return parseExecution("submitDeposit", body);
    },
    async status(depositAddress, depositMemo, callOptions) {
      const query = { depositAddress, depositMemo };
      const body = await call("status", { method: "GET", path: "/v0/status", query }, callOptions);
      return parseExecution("status", body);
    },
  };
}

export function quoteBody(input: QuoteInput): Record<string, unknown> {
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 0)
    throw new RangeError("slippageBps must be a whole number");
  if (input.amount <= 0n) throw new RangeError("amount must be positive");
  for (const fee of input.appFees) {
    if (!Number.isInteger(fee.feeBps) || fee.feeBps < 0)
      throw new RangeError("app fee must be whole basis points");
  }
  return {
    dry: input.dry,
    swapType: input.swapType,
    slippageTolerance: input.slippageBps,
    originAsset: input.originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: input.destinationAsset,
    amount: input.amount.toString(),
    refundTo: input.refundTo,
    refundType: input.refundType ?? "ORIGIN_CHAIN",
    recipient: input.recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: input.deadline.toISOString(),
    appFees: input.appFees.map((fee) => ({ recipient: fee.recipient, fee: fee.feeBps })),
    ...(input.customRecipientMsg === undefined ? {} : { customRecipientMsg: input.customRecipientMsg }),
    ...(input.referral === undefined ? {} : { referral: input.referral }),
  };
}

function parseToken(value: unknown): OneClickToken {
  const token = record("tokens", value);
  const decimals = token.decimals;
  if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0) {
    throw invalid("tokens", "decimals must be a whole number");
  }
  return {
    assetId: text("tokens", token, "assetId"),
    decimals,
    blockchain: text("tokens", token, "blockchain"),
    symbol: text("tokens", token, "symbol"),
    contractAddress: optionalText("tokens", token, "contractAddress"),
  };
}

function parseQuote(value: unknown, dry: boolean): OneClickQuote {
  const body = record("quote", value);
  const quote = record("quote", body.quote);
  const depositAddress = optionalText("quote", quote, "depositAddress");
  const deadline = optionalDate("quote", quote, "deadline");
  if (!dry && (depositAddress === undefined || deadline === undefined)) {
    throw invalid("quote", "a non-dry quote must carry depositAddress and deadline");
  }
  const timeEstimate = quote.timeEstimate;
  if (typeof timeEstimate !== "number" || timeEstimate < 0)
    throw invalid("quote", "timeEstimate must be a number");
  return {
    correlationId: text("quote", body, "correlationId"),
    signature: text("quote", body, "signature"),
    depositAddress,
    depositMemo: optionalText("quote", quote, "depositMemo"),
    amountIn: units("quote", quote, "amountIn"),
    minAmountIn: units("quote", quote, "minAmountIn"),
    amountOut: units("quote", quote, "amountOut"),
    minAmountOut: units("quote", quote, "minAmountOut"),
    amountInUsd: optionalText("quote", quote, "amountInUsd"),
    amountOutUsd: optionalText("quote", quote, "amountOutUsd"),
    deadline,
    timeWhenInactive: optionalDate("quote", quote, "timeWhenInactive"),
    timeEstimateSeconds: timeEstimate,
    raw: value,
  };
}

function parseExecution(operation: OneClickOperation, value: unknown): OneClickExecution {
  const body = record(operation, value);
  const status = body.status;
  if (!ONECLICK_STATUSES.includes(status as OneClickStatus)) {
    throw invalid(operation, `unknown status ${String(status).slice(0, 40)}`);
  }
  const updatedAt = optionalDate(operation, body, "updatedAt");
  if (!updatedAt) throw invalid(operation, "updatedAt is required");
  const details = record(operation, body.swapDetails);
  return {
    status: status as OneClickStatus,
    updatedAt,
    depositedAmount: optionalUnits(operation, details, "depositedAmount"),
    amountIn: optionalUnits(operation, details, "amountIn"),
    amountOut: optionalUnits(operation, details, "amountOut"),
    refundedAmount: optionalUnits(operation, details, "refundedAmount"),
    refundReason: optionalText(operation, details, "refundReason"),
    originTxHashes: hashes(operation, details, "originChainTxHashes"),
    destinationTxHashes: hashes(operation, details, "destinationChainTxHashes"),
    nearTxHashes: strings(operation, details, "nearTxHashes"),
  };
}

function record(operation: OneClickOperation, value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw invalid(operation, "expected an object");
  return value as Record<string, unknown>;
}

function text(operation: OneClickOperation, source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || value === "")
    throw invalid(operation, `${key} must be a non-empty string`);
  return value;
}

function optionalText(
  operation: OneClickOperation,
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  return source[key] === undefined || source[key] === null || source[key] === ""
    ? undefined
    : text(operation, source, key);
}

function units(operation: OneClickOperation, source: Record<string, unknown>, key: string): bigint {
  const value = source[key];
  if (typeof value !== "string" || !/^\d+$/.test(value))
    throw invalid(operation, `${key} must be an integer string`);
  return BigInt(value);
}

function optionalUnits(
  operation: OneClickOperation,
  source: Record<string, unknown>,
  key: string,
): bigint | undefined {
  return source[key] === undefined || source[key] === null || source[key] === ""
    ? undefined
    : units(operation, source, key);
}

function optionalDate(
  operation: OneClickOperation,
  source: Record<string, unknown>,
  key: string,
): Date | undefined {
  const value = optionalText(operation, source, key);
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw invalid(operation, `${key} must be a date`);
  return date;
}

function strings(operation: OneClickOperation, source: Record<string, unknown>, key: string): string[] {
  const value = source[key] ?? [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw invalid(operation, `${key} must be a list of strings`);
  }
  return value;
}

function hashes(operation: OneClickOperation, source: Record<string, unknown>, key: string): string[] {
  const value = source[key] ?? [];
  if (!Array.isArray(value)) throw invalid(operation, `${key} must be a list`);
  return value.map((item) => text(operation, record(operation, item), "hash"));
}

function errorMessage(body: string): string {
  try {
    const message = (JSON.parse(body) as { message?: unknown }).message;
    if (typeof message === "string") return message.slice(0, MAX_MESSAGE_LENGTH);
  } catch {
    return "request refused";
  }
  return "request refused";
}

function invalid(operation: OneClickOperation, detail: string): OneClickError {
  return new OneClickError(operation, "invalid_response", detail);
}
