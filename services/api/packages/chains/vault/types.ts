export type AccountId = string;
export type OrderId = string;

export const ORDER_STATES = ["registered", "executed", "released"] as const;
export type OrderState = (typeof ORDER_STATES)[number];

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

// What the backend may do with the registration key (§11.1). It can never move a user's funds.
export interface VaultClient {
  registerOrder(input: RegisterOrderInput): Promise<VaultTx>;
  setStatus(orderId: OrderId, status: ReceiptStatus, refs: ReceiptRefs): Promise<VaultTx>;
  recredit(orderId: OrderId, amount: bigint): Promise<VaultTx>;
  releaseOrder(orderId: OrderId): Promise<VaultTx>;
  getReceipt(orderId: OrderId): Promise<VaultReceipt | null>;
  getBalance(accountId: AccountId): Promise<VaultBalance>;
  getAgent(agentId: AccountId): Promise<AgentPolicy | null>;
}
