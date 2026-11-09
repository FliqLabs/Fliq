// Shapes follow the 1Click Swap API OpenAPI document, version 0.1.10 (https://1click.chaindefuser.com/docs/v0/openapi.yaml).
// Only the fields the backend uses are typed; the raw quote is kept because 1Click asks clients to store it.

export const ONECLICK_STATUSES = [
  "PENDING_DEPOSIT",
  "KNOWN_DEPOSIT_TX",
  "INCOMPLETE_DEPOSIT",
  "PROCESSING",
  "SUCCESS",
  "REFUNDED",
  "FAILED",
] as const;
export type OneClickStatus = (typeof ONECLICK_STATUSES)[number];

export const TERMINAL_STATUSES: ReadonlySet<OneClickStatus> = new Set(["SUCCESS", "REFUNDED", "FAILED"]);

export type OneClickToken = {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  contractAddress: string | undefined;
};

export type AppFee = { recipient: string; feeBps: number };

export type QuoteInput = {
  dry: boolean;
  swapType: "EXACT_INPUT" | "EXACT_OUTPUT" | "FLEX_INPUT";
  slippageBps: number;
  originAsset: string;
  destinationAsset: string;
  amount: bigint;
  refundTo: string;
  // INTENTS refunds to a NEAR account's Intents balance, for senders whose origin-chain address is unknown.
  refundType?: "ORIGIN_CHAIN" | "INTENTS";
  recipient: string;
  deadline: Date;
  appFees: readonly AppFee[];
  customRecipientMsg?: string;
  referral?: string;
};

export type OneClickQuote = {
  correlationId: string;
  signature: string;
  depositAddress: string | undefined;
  depositMemo: string | undefined;
  amountIn: bigint;
  minAmountIn: bigint;
  amountOut: bigint;
  minAmountOut: bigint;
  amountInUsd: string | undefined;
  amountOutUsd: string | undefined;
  deadline: Date | undefined;
  timeWhenInactive: Date | undefined;
  timeEstimateSeconds: number;
  raw: unknown;
};

export type DepositSubmission = {
  txHash: string;
  depositAddress: string;
  nearSenderAccount?: string;
  memo?: string;
};

export type OneClickExecution = {
  status: OneClickStatus;
  updatedAt: Date;
  depositedAmount: bigint | undefined;
  amountIn: bigint | undefined;
  amountOut: bigint | undefined;
  refundedAmount: bigint | undefined;
  refundReason: string | undefined;
  originTxHashes: string[];
  destinationTxHashes: string[];
  nearTxHashes: string[];
};

export type OneClickOperation = "tokens" | "quote" | "submitDeposit" | "status";

export type OneClickErrorKind =
  | "timeout"
  | "unavailable"
  | "unauthorized"
  | "rejected"
  | "invalid_response"
  | "cancelled";

// Messages never carry the API key or a full response body.
export class OneClickError extends Error {
  readonly operation: OneClickOperation;
  readonly kind: OneClickErrorKind;
  readonly httpStatus: number | undefined;

  constructor(operation: OneClickOperation, kind: OneClickErrorKind, detail: string, httpStatus?: number) {
    super(`1click ${operation} ${kind}: ${detail}`);
    this.name = "OneClickError";
    this.operation = operation;
    this.kind = kind;
    this.httpStatus = httpStatus;
  }

  // Only these mean "no answer"; the outcome of the request is unknown, never failed.
  get transient(): boolean {
    return this.kind === "timeout" || this.kind === "unavailable";
  }
}
