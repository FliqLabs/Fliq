import type { NearRpc } from "../near/rpc";
import { functionCallActions, publicKeyOf, signTransaction, type SigningKey } from "../near/transactions";
import {
  ORDER_STATES,
  RECEIPT_STATUSES,
  TRANSFER_STATES,
  VaultError,
  type AccountId,
  type AgentPolicy,
  type OrderId,
  type OrderState,
  type ReceiptRefs,
  type ReceiptStatus,
  type RegisterOrderInput,
  type TransferState,
  type VaultBalance,
  type VaultClient,
  type VaultReceipt,
  type VaultTx,
} from "./types";

// Gas per registrar method. recredit reads the vault's USDC balance and then credits in a callback (10 + 20 Tgas).
const GAS_TGAS = { register_order: 50n, set_status: 30n, release_order: 30n, recredit: 100n } as const;

export type NearVaultOptions = {
  rpc: NearRpc;
  contractId: AccountId;
  // The vault's registration account: it registers orders and records statuses, and can never move a user's funds.
  registration: SigningKey;
};

// A call the chain refused without a vault error code, or one whose outcome the RPC could not confirm.
export class VaultCallError extends Error {
  constructor(
    readonly method: string,
    detail: string,
  ) {
    super(`vault ${method} failed: ${detail.slice(0, 300)}`);
    this.name = "VaultCallError";
  }
}

const u128 = (value: unknown, field: string): bigint => {
  if (typeof value !== "string" || !/^\d+$/.test(value))
    throw new VaultCallError("view", `${field} is not a U128 string`);
  return BigInt(value);
};

function refsOut(refs: ReceiptRefs) {
  return {
    ...(refs.provider === undefined ? {} : { provider: refs.provider }),
    ...(refs.providerOrder === undefined ? {} : { provider_order: refs.providerOrder }),
    ...(refs.bankReference === undefined ? {} : { bank_reference: refs.bankReference }),
    ...(refs.refundTx === undefined ? {} : { refund_tx: refs.refundTx }),
  };
}

function refsIn(value: unknown): ReceiptRefs {
  const refs = (value ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof refs[key] === "string" ? (refs[key] as string) : undefined);
  return {
    ...(text("provider") ? { provider: text("provider") } : {}),
    ...(text("provider_order") ? { providerOrder: text("provider_order") } : {}),
    ...(text("bank_reference") ? { bankReference: text("bank_reference") } : {}),
    ...(text("refund_tx") ? { refundTx: text("refund_tx") } : {}),
  };
}

// The contract's receipt also carries its verified transfer track; the backend reads the compatible flat fields.
export function parseReceipt(value: unknown): VaultReceipt | null {
  if (value === null) return null;
  const receipt = value as Record<string, unknown>;
  const state = receipt.state as OrderState;
  if (!ORDER_STATES.includes(state))
    throw new VaultCallError("get_receipt", `unknown state ${String(receipt.state)}`);
  const transferState = receipt.transfer_state as TransferState;
  if (!TRANSFER_STATES.includes(transferState))
    throw new VaultCallError("get_receipt", `unknown transfer_state ${String(receipt.transfer_state)}`);
  const status = RECEIPT_STATUSES.includes(receipt.status as ReceiptStatus)
    ? (receipt.status as ReceiptStatus)
    : null;
  return {
    orderId: String(receipt.order_id),
    payer: String(receipt.payer),
    depositAddress: String(receipt.deposit_address),
    amount: u128(receipt.amount, "amount"),
    expiresAtNs: u128(receipt.expires_at_ns, "expires_at_ns"),
    corridor: String(receipt.corridor),
    state,
    transferState,
    status,
    refs: refsIn(receipt.refs),
    recreditedAmount: u128(receipt.recredited_amount, "recredited_amount"),
  };
}

export function parsePolicy(value: unknown): AgentPolicy | null {
  if (value === null) return null;
  const policy = value as Record<string, unknown>;
  return {
    owner: String(policy.owner),
    perPayoutCap: u128(policy.per_payout_cap, "per_payout_cap"),
    dailyCap: u128(policy.daily_cap, "daily_cap"),
    spentToday: u128(policy.spent_today, "spent_today"),
    corridors: Array.isArray(policy.corridors) ? policy.corridors.map(String) : null,
    publicKey: String(policy.public_key),
    expiresAtNs: u128(policy.expiry_ns, "expiry_ns"),
    revoked: policy.revoked === true,
  };
}

export class NearVault implements VaultClient {
  readonly #options: NearVaultOptions;
  readonly #publicKey: string;
  #queue: Promise<unknown> = Promise.resolve();
  // The last nonce this process signed with, in case the node answering the read is a block behind the send.
  #lastNonce = 0n;

  constructor(options: NearVaultOptions) {
    this.#options = options;
    this.#publicKey = publicKeyOf(options.registration.privateKey);
  }

  // One registration key signs every call, so calls are sent one after another and each takes the next nonce.
  #call(method: keyof typeof GAS_TGAS, args: object): Promise<VaultTx> {
    const run = async (): Promise<VaultTx> => {
      const { rpc, contractId, registration } = this.#options;
      const [key, block] = await Promise.all([
        rpc.accessKey(registration.accountId, this.#publicKey),
        rpc.finalBlock(),
      ]);
      if (!key) throw new VaultCallError(method, "the registration key is not on the registration account");
      this.#lastNonce = (key.nonce > this.#lastNonce ? key.nonce : this.#lastNonce) + 1n;
      const tx = await signTransaction({
        signer: registration,
        receiverId: contractId,
        nonce: this.#lastNonce,
        blockHash: block.hash,
        actions: functionCallActions(method, args, GAS_TGAS[method]),
      });
      const outcome = await rpc.sendTransaction(tx.base64);
      if (outcome.status === "failed") {
        const detail = outcome.failures.join(" ");
        throw VaultError.fromPanic(detail) ?? new VaultCallError(method, detail);
      }
      return { txHash: tx.txHash };
    };
    const next = this.#queue.then(run, run);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  #view(method: string, args: object): Promise<unknown> {
    return this.#options.rpc.callView(this.#options.contractId, method, args);
  }

  registerOrder(input: RegisterOrderInput): Promise<VaultTx> {
    return this.#call("register_order", {
      order_id: input.orderId,
      payer: input.payer,
      deposit_address: input.depositAddress,
      amount: input.amount.toString(),
      expires_at_ns: input.expiresAtNs.toString(),
      corridor: input.corridor,
      ...(input.agentId ? { agent_id: input.agentId } : {}),
    });
  }

  setStatus(orderId: OrderId, status: ReceiptStatus, refs: ReceiptRefs): Promise<VaultTx> {
    return this.#call("set_status", { order_id: orderId, status, refs: refsOut(refs) });
  }

  recredit(orderId: OrderId, amount: bigint): Promise<VaultTx> {
    return this.#call("recredit", { order_id: orderId, amount: amount.toString() });
  }

  releaseOrder(orderId: OrderId): Promise<VaultTx> {
    return this.#call("release_order", { order_id: orderId });
  }

  async getReceipt(orderId: OrderId): Promise<VaultReceipt | null> {
    return parseReceipt(await this.#view("get_receipt", { order_id: orderId }));
  }

  async getBalance(accountId: AccountId): Promise<VaultBalance> {
    const balance = (await this.#view("get_balance", { account_id: accountId })) as Record<string, unknown>;
    return {
      available: u128(balance.available, "available"),
      reserved: u128(balance.reserved, "reserved"),
      total: u128(balance.total, "total"),
    };
  }

  async getAgent(owner: AccountId, agentId: AccountId): Promise<AgentPolicy | null> {
    return parsePolicy(await this.#view("get_policy", { owner, agent_id: agentId }));
  }
}
