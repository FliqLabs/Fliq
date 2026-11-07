export type AccountId = string;
export type OrderId = string;

export const ORDER_STATES = ["registered", "executed", "released"] as const;
export type OrderState = (typeof ORDER_STATES)[number];

// The contract's verified transfer track. "executed" covers both executing and dispatched; only dispatched means
// the USDC left the vault, and the contract refuses paying_out and settled before it.
export const TRANSFER_STATES = ["registered", "executing", "dispatched", "transfer_failed", "released"] as const;
export type TransferState = (typeof TRANSFER_STATES)[number];

export const RECEIPT_STATUSES = [
  "routing",
  "with_provider",
  "paying_out",
  "settled",
  "refunding",
  "refunded",
  "failed",
] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

const AFTER_EXECUTION: readonly ReceiptStatus[] = [
  "routing",
  "with_provider",
  "paying_out",
  "settled",
  "refunding",
  "failed",
];

export const STATUS_TRANSITIONS: Readonly<Record<ReceiptStatus | "none", readonly ReceiptStatus[]>> = {
  none: AFTER_EXECUTION,
  routing: ["with_provider", "paying_out", "settled", "refunding", "failed"],
  with_provider: ["paying_out", "settled", "refunding", "failed"],
  paying_out: ["settled", "refunding", "failed"],
  // refunded is reached only through recredit, so a receipt never says refunded unless the money came back.
  refunding: ["failed"],
  settled: [],
  refunded: [],
  failed: [],
};

export function canSetStatus(from: ReceiptStatus | null, to: ReceiptStatus): boolean {
  return STATUS_TRANSITIONS[from ?? "none"].includes(to);
}

export const MAX_REF_BYTES = 128;

export function isValidRef(value: string): boolean {
  return value.length <= MAX_REF_BYTES && /^[\x21-\x7e]+$/.test(value);
}

export type ReceiptRefs = {
  provider?: string;
  providerOrder?: string;
  bankReference?: string;
  refundTx?: string;
};

export type RegisterOrderInput = {
  orderId: OrderId;
  payer: AccountId;
  depositAddress: string;
  amount: bigint;
  expiresAtNs: bigint;
  corridor: string;
};

export type VaultReceipt = RegisterOrderInput & {
  state: OrderState;
  transferState: TransferState;
  status: ReceiptStatus | null;
  refs: ReceiptRefs;
  recreditedAmount: bigint;
};

export type VaultBalance = { available: bigint; reserved: bigint; total: bigint };

export type AgentPolicy = {
  owner: AccountId;
  perPayoutCap: bigint;
  dailyCap: bigint;
  spentToday: bigint;
  corridors: readonly string[] | null;
  // Present when read from the deployed contract, which keys a policy to the agent's signing key.
  publicKey?: string;
  expiresAtNs?: bigint;
  revoked?: boolean;
};

export const VAULT_ERROR_CODES = [
  "UNAUTHORIZED",
  "ORDER_EXISTS",
  "ORDER_NOT_FOUND",
  "INVALID_AMOUNT",
  "INVALID_EXPIRY",
  "INSUFFICIENT_BALANCE",
  "ORDER_NOT_REGISTERED",
  "ORDER_EXPIRED",
  "ORDER_NOT_EXPIRED",
  "POLICY_PER_PAYOUT_CAP",
  "POLICY_DAILY_CAP",
  "POLICY_CORRIDOR",
  "INVALID_TRANSITION",
  "NOT_REFUNDABLE",
  "ALREADY_RECREDITED",
  "RECREDIT_EXCEEDS_ORDER",
  "RECREDIT_EXCEEDS_UNATTRIBUTED",
  "INVALID_REF",
  "REF_IMMUTABLE",
  "AGENT_NOT_FOUND",
  "AGENT_TAKEN",
  // The deployed contract's own codes (contracts/vault/src/errors.rs).
  "INITIALIZER_ONLY",
  "ALREADY_INITIALIZED",
  "OWNER_ONLY",
  "REGISTRATION_ONLY",
  "INVALID_ORDER_ID",
  "INVALID_CORRIDOR",
  "INVALID_ADDRESS",
  "INVALID_STATE",
  "AMOUNT_MISMATCH",
  "DESTINATION_MISMATCH",
  "INSUFFICIENT_GAS",
  "INVALID_STATUS",
  "INVALID_REFS",
  "STATUS_BACKWARD",
  "STATUS_TERMINAL",
  "CALLBACK_UNAUTHORIZED",
  "CALLBACK_PROMISE_COUNT",
  "EXECUTING_SINCE_MISSING",
  "TIMEOUT_NOT_REACHED",
  "NO_ATTACHED_DEPOSIT",
  "RECEIPT_NOT_FOUND",
  "TRANSFER_ENCODING",
  "CALLBACK_ENCODING",
  "PAYOUT_NOT_EXECUTING",
  "REFUND_NOT_ALLOWED",
  "INVALID_REFUND_STATUS",
  "ORDER_DETAILS_MISSING",
  "STUCK_PAYOUT_UNRESOLVED",
  "TEST_ACCOUNT_UNREGISTERED",
  "BALANCE_INVARIANT",
  "STORAGE_MEASUREMENT_FAILED",
  "STORAGE_CALCULATION_OVERFLOW",
  "STORAGE_DEPOSIT_REQUIRED",
  "STORAGE_WITHDRAWAL_UNAVAILABLE",
  "ACCOUNT_NOT_REGISTERED",
  "ACCOUNT_BALANCE_NONZERO",
  "ONE_YOCTO_REQUIRED",
  "INVALID_POLICY",
  "POLICY_NOT_FOUND",
  "POLICY_REVOKED",
  "POLICY_EXPIRED",
  "POLICY_COOLDOWN",
  "POLICY_PENDING_EXISTS",
  "POLICY_ARITHMETIC",
  "VAULT_RESERVATION_FAILED",
  "VAULT_COMMIT_FAILED",
  "VAULT_RELEASE_FAILED",
  "VAULT_REFUND_FAILED",
  "RELEASED_ORDER",
] as const;
export type VaultErrorCode = (typeof VAULT_ERROR_CODES)[number];

const PANIC_PREFIX = "fliq_vault: ";

export class VaultError extends Error {
  readonly code: VaultErrorCode;

  constructor(code: VaultErrorCode) {
    super(`${PANIC_PREFIX}${code}`);
    this.name = "VaultError";
    this.code = code;
  }

  // The contract refuses by panicking with this prefix, so a failed transaction's message maps back to a code.
  static fromPanic(message: string): VaultError | null {
    const index = message.indexOf(PANIC_PREFIX);
    if (index === -1) return null;
    const code = message.slice(index + PANIC_PREFIX.length).match(/^[A-Z_]+/)?.[0];
    return VAULT_ERROR_CODES.find((known) => known === code) ? new VaultError(code as VaultErrorCode) : null;
  }
}

export type TopUpMessage = { top_up: { account_id: AccountId } };

export function topUpMessage(accountId: AccountId): string {
  const message: TopUpMessage = { top_up: { account_id: accountId } };
  return JSON.stringify(message);
}

export type VaultTx = { txHash: string };

// The contract's default max_expiry: register_order refuses an expires_at_ns further ahead than this.
export const MAX_ORDER_TTL_MS = 24 * 60 * 60 * 1000;

// What the backend may do with the registration key (§11.1). It can never move a user's funds.
export interface VaultClient {
  registerOrder(input: RegisterOrderInput): Promise<VaultTx>;
  setStatus(orderId: OrderId, status: ReceiptStatus, refs: ReceiptRefs): Promise<VaultTx>;
  recredit(orderId: OrderId, amount: bigint): Promise<VaultTx>;
  releaseOrder(orderId: OrderId): Promise<VaultTx>;
  getReceipt(orderId: OrderId): Promise<VaultReceipt | null>;
  getBalance(accountId: AccountId): Promise<VaultBalance>;
  getAgent(owner: AccountId, agentId: AccountId): Promise<AgentPolicy | null>;
}
