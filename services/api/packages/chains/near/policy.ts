import type { DelegatedCall, VerifiedDelegate } from "./delegate";

const TGAS = 1_000_000_000_000n;
export const MAX_GAS_PER_CALL = 100n * TGAS;
// The vault's payout forwards 30 Tgas to ft_transfer and 20 Tgas to its callback, and refuses less prepaid gas.
export const MIN_PAYOUT_GAS = 50n * TGAS;
const MAX_ARGS_BYTES = 2_048;
const ONE_YOCTO = 1n;
const POSITIVE_INTEGER = /^[1-9]\d*$/;
const NEAR_ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const CORRIDOR = /^[A-Z]{2}-[A-Z]{3}-[a-z_]+$/;
const ED25519_KEY = /^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const U64_MAX = 2n ** 64n - 1n;
// set_agent charges the owner for the policy's storage out of the attached deposit and refunds the rest.
// A policy is a few hundred bytes, so 0.01 NEAR is ample and bounds what one relayed call can attach.
export const MAX_AGENT_STORAGE_DEPOSIT = 10n ** 22n;

export type RelayPolicy = { vaultContractId: string; usdcContractId: string };

export class PolicyError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "PolicyError";
  }
}

type Rule = {
  deposit: { min: bigint; max: bigint };
  checkArgs: (args: Record<string, unknown>) => void;
};

const exactly = (amount: bigint) => ({ min: amount, max: amount });

// The only things the relayer pays gas for (architecture §11.2). Deposits come out of the sender's own balance in
// a meta transaction, so storage registration is never relayed: the account creator sponsors it instead.
function rules(policy: RelayPolicy): Map<string, Map<string, Rule>> {
  const orderOnly: Rule = { deposit: exactly(0n), checkArgs: (args) => exactKeys(args, ["order_id"], ["order_id"]) };
  // The vault refuses a payout whose amount or destination differs from the registered order, so the user signs both.
  const payout: Rule = {
    deposit: exactly(0n),
    checkArgs: (args) => {
      const keys = ["order_id", "amount", "deposit_address"];
      exactKeys({ ...args, amount: String(args.amount) }, keys, keys);
      if (!isPositiveAmount(args.amount)) throw new PolicyError("amount must be a positive integer");
      if (!/^[a-z0-9._-]{2,64}$/.test(String(args.deposit_address)))
        throw new PolicyError("deposit_address must be a NEAR account id");
    },
  };
  // Matches the deployed vault's set_agent: the agent's key is a label, and cooldown and expiry are nanoseconds.
  const setAgent: Rule = {
    deposit: { min: ONE_YOCTO, max: MAX_AGENT_STORAGE_DEPOSIT },
    checkArgs: (args) => {
      const keys = ["public_key", "agent_id", "per_payout_cap", "daily_cap", "corridors", "cooldown_ns", "expiry_ns"];
      exactKeys(args, keys, ["public_key", "agent_id", "per_payout_cap", "daily_cap", "cooldown_ns", "expiry_ns"]);
      if (!ED25519_KEY.test(String(args.public_key))) throw new PolicyError("public_key must be an ed25519 key");
      agentId(args.agent_id);
      for (const cap of ["per_payout_cap", "daily_cap"]) {
        if (!POSITIVE_INTEGER.test(String(args[cap])))
          throw new PolicyError(`${cap} must be a positive integer string`);
      }
      if (BigInt(String(args.per_payout_cap)) > BigInt(String(args.daily_cap)))
        throw new PolicyError("per_payout_cap must not exceed daily_cap");
      for (const field of ["cooldown_ns", "expiry_ns"]) {
        const value = String(args[field]);
        if (!/^\d+$/.test(value) || BigInt(value) > U64_MAX)
          throw new PolicyError(`${field} must be an unsigned 64-bit integer string`);
      }
      const corridors = args.corridors ?? null;
      if (
        corridors !== null &&
        !(
          Array.isArray(corridors) &&
          corridors.length > 0 &&
          corridors.every((c) => typeof c === "string" && CORRIDOR.test(c))
        )
      ) {
        throw new PolicyError("corridors must be null or a non-empty list of corridors");
      }
    },
  };
  const removeAgent: Rule = {
    deposit: exactly(ONE_YOCTO),
    checkArgs: (args) => {
      exactKeys(args, ["agent_id"], ["agent_id"]);
      agentId(args.agent_id);
    },
  };
  // Vault to vault between fliq users. The vault requires one yoctoNEAR so only a full-access key can move funds.
  const transfer: Rule = {
    deposit: exactly(ONE_YOCTO),
    checkArgs: (args) => {
      exactKeys(args, ["to_account", "amount"], ["to_account", "amount"]);
      if (!NEAR_ACCOUNT.test(String(args.to_account))) throw new PolicyError("to_account must be a NEAR account id");
      if (!POSITIVE_INTEGER.test(String(args.amount))) throw new PolicyError("amount must be a positive integer string");
    },
  };
  // The user's own available USDC back to their own account. One yoctoNEAR, like transfer.
  const withdraw: Rule = {
    deposit: exactly(ONE_YOCTO),
    checkArgs: (args) => {
      exactKeys(args, ["amount"], ["amount"]);
      if (!POSITIVE_INTEGER.test(String(args.amount))) throw new PolicyError("amount must be a positive integer string");
    },
  };
  return new Map([
    [
      policy.vaultContractId,
      new Map([
        ["payout", payout],
        ["withdraw", withdraw],
        ["release_order", orderOnly],
        ["set_agent", setAgent],
        ["remove_agent", removeAgent],
        ["transfer", transfer],
      ]),
    ],
    [
      policy.usdcContractId,
      new Map<string, Rule>([
        [
          "ft_transfer_call",
          {
            deposit: exactly(ONE_YOCTO),
            checkArgs: (args) => {
              exactKeys(args, ["receiver_id", "amount", "msg"], ["receiver_id", "amount", "msg"]);
              if (args.receiver_id !== policy.vaultContractId)
                throw new PolicyError("USDC may only be sent to the vault");
              if (!POSITIVE_INTEGER.test(String(args.amount)))
                throw new PolicyError("amount must be a positive integer string");
              if (args.msg !== "")
                throw new PolicyError("a top-up from NEAR credits the sender, so msg must be empty");
            },
          },
        ],
      ]),
    ],
  ]);
}

export function checkPolicy(policy: RelayPolicy, delegate: VerifiedDelegate): void {
  const allowed = rules(policy).get(delegate.receiverId);
  if (!allowed) throw new PolicyError(`receiver ${delegate.receiverId} is not allowed`);
  if (delegate.calls.length !== 1) throw new PolicyError("a relayed delegate must contain exactly one call");
  const call = delegate.calls[0] as DelegatedCall;
  const rule = allowed.get(call.methodName);
  if (!rule) {
    throw new PolicyError(`method ${call.methodName} is not allowed on ${delegate.receiverId}`);
  }
  if (call.deposit < rule.deposit.min || call.deposit > rule.deposit.max) {
    const { min, max } = rule.deposit;
    throw new PolicyError(
      min === max
        ? `${call.methodName} must attach exactly ${min} yoctoNEAR`
        : `${call.methodName} must attach between ${min} and ${max} yoctoNEAR`,
    );
  }
  if (call.gas <= 0n || call.gas > MAX_GAS_PER_CALL)
    throw new PolicyError("gas must be between 1 and 100 Tgas");
  if (call.methodName === "payout" && call.gas < MIN_PAYOUT_GAS)
    throw new PolicyError("payout needs at least 50 Tgas");
  if (call.args.length > MAX_ARGS_BYTES) throw new PolicyError("arguments are too large");
  rule.checkArgs(jsonArgs(call.args));
}

function jsonArgs(bytes: Uint8Array): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new PolicyError("arguments must be JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new PolicyError("arguments must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

// The contract takes amount as U128 (a string) or u128 (a JSON number); either must be an exact positive integer.
function isPositiveAmount(value: unknown): boolean {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0;
  return typeof value === "string" && /^[1-9]\d*$/.test(value);
}

function agentId(value: unknown): void {
  if (typeof value !== "string" || !NEAR_ACCOUNT.test(value))
    throw new PolicyError("agent_id must be a NEAR account id");
}

function exactKeys(args: Record<string, unknown>, allowed: string[], required: string[]): void {
  const unexpected = Object.keys(args).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) throw new PolicyError(`unexpected arguments: ${unexpected.join(", ")}`);
  for (const key of required) {
    if (typeof args[key] !== "string") throw new PolicyError(`${key} must be a string`);
  }
  if (typeof args.order_id === "string" && (args.order_id === "" || args.order_id.length > 64)) {
    throw new PolicyError("order_id must be 1 to 64 characters");
  }
}
