import type { DelegatedCall, VerifiedDelegate } from "./delegate";

const TGAS = 1_000_000_000_000n;
export const MAX_GAS_PER_CALL = 100n * TGAS;
const MAX_ARGS_BYTES = 2_048;
const ONE_YOCTO = 1n;

export type RelayPolicy = { vaultContractId: string; usdcContractId: string };

export class PolicyError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "PolicyError";
  }
}

type Rule = {
  deposit: bigint;
  checkArgs: (args: Record<string, unknown>) => void;
};

// The only things the relayer pays gas for (architecture §11.2). Deposits come out of the sender's own balance in
// a meta transaction, so storage registration is never relayed: the account creator sponsors it instead.
function rules(policy: RelayPolicy): Map<string, Map<string, Rule>> {
  const orderOnly: Rule = { deposit: 0n, checkArgs: (args) => exactKeys(args, ["order_id"], ["order_id"]) };
  return new Map([
    [
      policy.vaultContractId,
      new Map([
        ["payout", orderOnly],
        ["release_order", orderOnly],
      ]),
    ],
    [
      policy.usdcContractId,
      new Map<string, Rule>([
        [
          "ft_transfer_call",
          {
            deposit: ONE_YOCTO,
            checkArgs: (args) => {
              exactKeys(args, ["receiver_id", "amount", "msg"], ["receiver_id", "amount", "msg"]);
              if (args.receiver_id !== policy.vaultContractId)
                throw new PolicyError("USDC may only be sent to the vault");
              if (!/^[1-9]\d*$/.test(String(args.amount)))
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
  if (call.deposit !== rule.deposit)
    throw new PolicyError(`${call.methodName} must attach exactly ${rule.deposit} yoctoNEAR`);
  if (call.gas <= 0n || call.gas > MAX_GAS_PER_CALL)
    throw new PolicyError("gas must be between 1 and 100 Tgas");
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
