import { formatVaultEvent, type VaultEvent } from "./events";
import {
  canSetStatus,
  isValidRef,
  VaultError,
  type AccountId,
  type AgentPolicy,
  type OrderId,
  type ReceiptRefs,
  type ReceiptStatus,
  type RegisterOrderInput,
  type VaultBalance,
  type VaultClient,
  type VaultReceipt,
  type VaultTx,
} from "./types";

const NS_PER_DAY = 86_400n * 1_000_000_000n;

export type MockVaultOptions = {
  registrar: AccountId;
  usdc: AccountId;
  now: () => bigint;
  maxOrderTtlNs?: bigint;
};

export type IncomingTransfer = { predecessor: AccountId; senderId: AccountId; amount: bigint; msg: string };

export type AgentRule = Omit<AgentPolicy, "owner" | "spentToday">;

// In-memory model of the vault as proposed in INTERFACE.md, for local runs and tests until a testnet
// deployment exists. Most of it is not in the real contract yet.
export class MockVault implements VaultClient {
  readonly events: VaultEvent[] = [];
  readonly #options: Required<MockVaultOptions>;
  readonly #storage = new Set<AccountId>();
  readonly #balances = new Map<AccountId, { available: bigint; reserved: bigint }>();
  readonly #orders = new Map<OrderId, VaultReceipt>();
  readonly #agents = new Map<AccountId, AgentRule & { owner: AccountId }>();
  readonly #spent = new Map<string, bigint>();
  #tokenBalance = 0n;
  #txCount = 0;

  constructor(options: MockVaultOptions) {
    this.#options = { maxOrderTtlNs: NS_PER_DAY, ...options };
  }

  as(predecessor: AccountId): Pick<VaultClient, "registerOrder" | "setStatus" | "recredit" | "releaseOrder"> {
    return {
      registerOrder: async (input) => this.#registerOrder(predecessor, input),
      setStatus: async (orderId, status, refs) => this.#setStatus(predecessor, orderId, status, refs),
      recredit: async (orderId, amount) => this.#recredit(predecessor, orderId, amount),
      releaseOrder: async (orderId) => this.#releaseOrder(predecessor, orderId),
    };
  }

  registerOrder(input: RegisterOrderInput): Promise<VaultTx> {
    return this.as(this.#options.registrar).registerOrder(input);
  }

  setStatus(orderId: OrderId, status: ReceiptStatus, refs: ReceiptRefs): Promise<VaultTx> {
    return this.as(this.#options.registrar).setStatus(orderId, status, refs);
  }

  recredit(orderId: OrderId, amount: bigint): Promise<VaultTx> {
    return this.as(this.#options.registrar).recredit(orderId, amount);
  }

  releaseOrder(orderId: OrderId): Promise<VaultTx> {
    return this.as(this.#options.registrar).releaseOrder(orderId);
  }

  async getReceipt(orderId: OrderId): Promise<VaultReceipt | null> {
    const order = this.#orders.get(orderId);
    return order ? structuredClone(order) : null;
  }

  async getBalance(accountId: AccountId): Promise<VaultBalance> {
    const { available, reserved } = this.#balance(accountId);
    return { available, reserved, total: available + reserved };
  }

  async getAgent(owner: AccountId, agentId: AccountId): Promise<AgentPolicy | null> {
    const agent = this.#agents.get(agentId);
    return agent && agent.owner === owner ? { ...agent, spentToday: this.#spentToday(agentId) } : null;
  }

  logs(): string[] {
    return this.events.map(formatVaultEvent);
  }

  registerStorage(accountId: AccountId): void {
    this.#storage.add(accountId);
  }
  setAgent(owner: AccountId, agentId: AccountId, rule: AgentRule): VaultTx {
    if (rule.perPayoutCap <= 0n || rule.dailyCap <= 0n) throw new VaultError("INVALID_AMOUNT");
    const existing = this.#agents.get(agentId);
    if (existing && existing.owner !== owner) throw new VaultError("AGENT_TAKEN");
    this.#agents.set(agentId, { ...rule, owner });
    this.events.push({
      event: "agent_set",
      owner,
      publicKey: mockKeyOf(agentId, rule.publicKey),
      agentId,
      perPayoutCap: rule.perPayoutCap,
      dailyCap: rule.dailyCap,
      corridors: rule.corridors,
      cooldownNs: 0n,
      expiryNs: rule.expiresAtNs ?? this.#options.now() + NS_PER_DAY,
    });
    return this.#tx();
  }

  removeAgent(owner: AccountId, agentId: AccountId): VaultTx {
    const agent = this.#agents.get(agentId);
    if (agent?.owner !== owner) throw new VaultError("AGENT_NOT_FOUND");
    this.#agents.delete(agentId);
    this.events.push({ event: "agent_revoked", owner, agentId, publicKey: mockKeyOf(agentId, agent.publicKey) });
    return this.#tx();
  }

  // ft_on_transfer: returns the amount handed back to the sender, as NEP-141 does.
  ftOnTransfer({ predecessor, senderId, amount, msg }: IncomingTransfer): bigint {
    if (predecessor !== this.#options.usdc || amount <= 0n) return amount;
    const beneficiary = msg === "" ? senderId : parseTopUp(msg);
    if (!beneficiary || !this.#storage.has(beneficiary)) return amount;
    const balance = this.#balance(beneficiary);
    this.#balances.set(beneficiary, { ...balance, available: balance.available + amount });
    this.#tokenBalance += amount;
    this.events.push({ event: "deposited", accountId: beneficiary, senderId, amount });
    return 0n;
  }

  // A plain ft_transfer into the vault, which is how provider and 1Click refunds arrive: nothing is credited.
  receivePlainTransfer(amount: bigint): void {
    this.#tokenBalance += amount;
  }

  unattributed(): bigint {
    let credited = 0n;
    for (const { available, reserved } of this.#balances.values()) credited += available + reserved;
    return this.#tokenBalance - credited;
  }

  // predecessor is the only caller identity a relayed call carries: NEP-366 leaves the relayer's key as signer.
  payout(predecessor: AccountId, orderId: OrderId): VaultTx {
    const order = this.#order(orderId);
    const agent = predecessor === order.payer ? null : this.#agents.get(predecessor);
    if (agent === undefined || (agent && agent.owner !== order.payer)) throw new VaultError("UNAUTHORIZED");
    if (agent && order.agentId !== predecessor) throw new VaultError("AGENT_NOT_BOUND");
    if (order.state !== "registered") throw new VaultError("ORDER_NOT_REGISTERED");
    if (this.#options.now() >= order.expiresAtNs) throw new VaultError("ORDER_EXPIRED");
    if (agent) this.#enforcePolicy(predecessor, agent, order);

    const balance = this.#balance(order.payer);
    this.#balances.set(order.payer, { ...balance, reserved: balance.reserved - order.amount });
    this.#tokenBalance -= order.amount;
    order.state = "executed";
    order.transferState = "dispatched";
    this.events.push({
      event: "payout_executed",
      orderId,
      payer: order.payer,
      depositAddress: order.depositAddress,
      amount: order.amount,
      publicKey: mockKeyOf(predecessor, agent?.publicKey),
    });
    return this.#tx();
  }

  #registerOrder(predecessor: AccountId, input: RegisterOrderInput): VaultTx {
    this.#requireRegistrar(predecessor);
    if (this.#orders.has(input.orderId)) throw new VaultError("ORDER_EXISTS");
    if (input.amount <= 0n) throw new VaultError("INVALID_AMOUNT");
    const now = this.#options.now();
    if (input.expiresAtNs <= now || input.expiresAtNs - now > this.#options.maxOrderTtlNs) {
      throw new VaultError("INVALID_EXPIRY");
    }
    const balance = this.#balance(input.payer);
    if (balance.available < input.amount) throw new VaultError("INSUFFICIENT_BALANCE");

    this.#balances.set(input.payer, {
      available: balance.available - input.amount,
      reserved: balance.reserved + input.amount,
    });
    this.#orders.set(input.orderId, {
      ...input,
      state: "registered",
      transferState: "registered",
      status: null,
      refs: {},
      recreditedAmount: 0n,
    });
    this.events.push({ event: "order_registered", ...input });
    return this.#tx();
  }

  #releaseOrder(predecessor: AccountId, orderId: OrderId): VaultTx {
    const order = this.#order(orderId);
    const isRegistrar = predecessor === this.#options.registrar;
    if (!isRegistrar && predecessor !== order.payer) throw new VaultError("UNAUTHORIZED");
    if (order.state !== "registered") throw new VaultError("ORDER_NOT_REGISTERED");
    if (!isRegistrar && this.#options.now() < order.expiresAtNs) throw new VaultError("ORDER_NOT_EXPIRED");

    const balance = this.#balance(order.payer);
    this.#balances.set(order.payer, {
      available: balance.available + order.amount,
      reserved: balance.reserved - order.amount,
    });
    order.state = "released";
    order.transferState = "released";
    this.events.push({ event: "order_released", orderId, payer: order.payer, amount: order.amount });
    return this.#tx();
  }

  #setStatus(predecessor: AccountId, orderId: OrderId, status: ReceiptStatus, refs: ReceiptRefs): VaultTx {
    this.#requireRegistrar(predecessor);
    const order = this.#order(orderId);
    if (order.state !== "executed" || !canSetStatus(order.status, status)) {
      throw new VaultError("INVALID_TRANSITION");
    }
    for (const [key, value] of Object.entries(refs) as [keyof ReceiptRefs, string | undefined][]) {
      if (value === undefined) continue;
      if (!isValidRef(value)) throw new VaultError("INVALID_REF");
      if (order.refs[key] !== undefined && order.refs[key] !== value) throw new VaultError("REF_IMMUTABLE");
    }
    order.status = status;
    order.refs = { ...order.refs, ...refs };
    this.events.push({ event: "status_set", orderId, status, refs });
    return this.#tx();
  }

  #recredit(predecessor: AccountId, orderId: OrderId, amount: bigint): VaultTx {
    this.#requireRegistrar(predecessor);
    const order = this.#order(orderId);
    if (order.recreditedAmount > 0n) throw new VaultError("ALREADY_RECREDITED");
    if (order.state !== "executed" || order.status !== "refunding") {
      throw new VaultError("NOT_REFUNDABLE");
    }
    if (amount <= 0n) throw new VaultError("INVALID_AMOUNT");
    if (amount > order.amount) throw new VaultError("RECREDIT_EXCEEDS_ORDER");
    if (amount > this.unattributed()) throw new VaultError("RECREDIT_EXCEEDS_UNATTRIBUTED");

    const balance = this.#balance(order.payer);
    this.#balances.set(order.payer, { ...balance, available: balance.available + amount });
    order.recreditedAmount = amount;
    order.status = "refunded";
    this.events.push({ event: "recredited", orderId, payer: order.payer, amount });
    this.events.push({ event: "status_set", orderId, status: "refunded", refs: {} });
    return this.#tx();
  }

  #enforcePolicy(agentId: AccountId, rule: AgentRule, order: VaultReceipt): void {
    if (rule.corridors && !rule.corridors.includes(order.corridor)) throw new VaultError("POLICY_CORRIDOR");
    if (order.amount > rule.perPayoutCap) throw new VaultError("POLICY_PER_PAYOUT_CAP");
    const spent = this.#spentToday(agentId);
    if (spent + order.amount > rule.dailyCap) throw new VaultError("POLICY_DAILY_CAP");
    this.#spent.set(this.#dayKey(agentId), spent + order.amount);
  }

  #spentToday(agentId: AccountId): bigint {
    return this.#spent.get(this.#dayKey(agentId)) ?? 0n;
  }

  #dayKey(agentId: AccountId): string {
    return `${agentId}:${this.#options.now() / NS_PER_DAY}`;
  }

  #requireRegistrar(predecessor: AccountId): void {
    if (predecessor !== this.#options.registrar) throw new VaultError("UNAUTHORIZED");
  }

  #order(orderId: OrderId): VaultReceipt {
    const order = this.#orders.get(orderId);
    if (!order) throw new VaultError("ORDER_NOT_FOUND");
    return order;
  }

  #balance(accountId: AccountId): { available: bigint; reserved: bigint } {
    return this.#balances.get(accountId) ?? { available: 0n, reserved: 0n };
  }

  #tx(): VaultTx {
    this.#txCount += 1;
    return { txHash: `mock-tx-${this.#txCount}` };
  }
}

function parseTopUp(msg: string): AccountId | null {
  try {
    const parsed: unknown = JSON.parse(msg);
    if (typeof parsed !== "object" || parsed === null || Object.keys(parsed).join() !== "top_up") return null;
    const topUp = (parsed as { top_up: unknown }).top_up;
    if (typeof topUp !== "object" || topUp === null || Object.keys(topUp).join() !== "account_id")
      return null;
    const accountId = (topUp as { account_id: unknown }).account_id;
    return typeof accountId === "string" && accountId !== "" ? accountId : null;
  } catch {
    return null;
  }
}

// The contract logs the signing key; the model has no keys, so it names the caller instead.
function mockKeyOf(accountId: AccountId, publicKey: string | undefined): string {
  return publicKey ?? `mock:${accountId}`;
}
