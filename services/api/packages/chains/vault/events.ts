import { isValidRef, RECEIPT_STATUSES, type ReceiptRefs, type ReceiptStatus } from "./types";

export const VAULT_EVENT_STANDARD = "fliq_vault";
export const VAULT_EVENT_VERSION = "1.0.0";

const EVENT_PREFIX = "EVENT_JSON:";
const U64_MAX = 2n ** 64n - 1n;
const U128_MAX = 2n ** 128n - 1n;
const REF_KEYS = ["provider", "provider_order", "bank_reference", "refund_tx"] as const;

type FieldKind = "text" | "u64" | "u128" | "bool" | "status" | "refs" | "corridors";

const EVENT_FIELDS = {
  order_registered: {
    order_id: "text",
    payer: "text",
    deposit_address: "text",
    amount: "u128",
    expires_at_ns: "u64",
    corridor: "text",
  },
  payout_executed: {
    order_id: "text",
    payer: "text",
    deposit_address: "text",
    amount: "u128",
    public_key: "text",
  },
  order_released: { order_id: "text", payer: "text", amount: "u128" },
  status_set: { order_id: "text", status: "status", refs: "refs" },
  recredited: { order_id: "text", payer: "text", amount: "u128" },
  deposited: { account_id: "text", sender_id: "text", amount: "u128" },
  transferred: { from: "text", to: "text", amount: "u128" },
  agent_set: {
    owner: "text",
    public_key: "text",
    agent_id: "text",
    per_payout_cap: "u128",
    daily_cap: "u128",
    corridors: "corridors",
    cooldown_ns: "u64",
    expiry_ns: "u64",
  },
  agent_revoked: { owner: "text", agent_id: "text", public_key: "text" },
  agent_spend: { owner: "text", agent_id: "text", order_id: "text", amount: "u128" },
  agent_spend_reversed: { owner: "text", agent_id: "text", order_id: "text", amount: "u128" },
  payout_failed: { order_id: "text", payer: "text", amount: "u128" },
  payout_resolved: { order_id: "text", transferred: "bool", resolved_by: "text" },
  payout_timeout_set: { payout_timeout: "u64" },
  withdrawn: { account_id: "text", amount: "u128" },
  withdraw_failed: { account_id: "text", amount: "u128" },
} as const satisfies Record<string, Record<string, FieldKind>>;

export type VaultEventName = keyof typeof EVENT_FIELDS;

export type VaultEvent =
  | {
      event: "order_registered";
      orderId: string;
      payer: string;
      depositAddress: string;
      amount: bigint;
      expiresAtNs: bigint;
      corridor: string;
    }
  | {
      event: "payout_executed";
      orderId: string;
      payer: string;
      depositAddress: string;
      amount: bigint;
      publicKey: string;
    }
  | { event: "order_released"; orderId: string; payer: string; amount: bigint }
  | { event: "status_set"; orderId: string; status: ReceiptStatus; refs: ReceiptRefs }
  | { event: "recredited"; orderId: string; payer: string; amount: bigint }
  | { event: "deposited"; accountId: string; senderId: string; amount: bigint }
  | { event: "transferred"; from: string; to: string; amount: bigint }
  | {
      event: "agent_set";
      owner: string;
      publicKey: string;
      agentId: string;
      perPayoutCap: bigint;
      dailyCap: bigint;
      corridors: readonly string[] | null;
      cooldownNs: bigint;
      expiryNs: bigint;
    }
  | { event: "agent_revoked"; owner: string; agentId: string; publicKey: string }
  | { event: "agent_spend"; owner: string; agentId: string; orderId: string; amount: bigint }
  | { event: "agent_spend_reversed"; owner: string; agentId: string; orderId: string; amount: bigint }
  | { event: "payout_failed"; orderId: string; payer: string; amount: bigint }
  | { event: "payout_resolved"; orderId: string; transferred: boolean; resolvedBy: string }
  | { event: "payout_timeout_set"; payoutTimeout: bigint }
  | { event: "withdrawn"; accountId: string; amount: bigint }
  | { event: "withdraw_failed"; accountId: string; amount: bigint };

export class VaultEventError extends Error {
  constructor(problem: string) {
    super(`invalid fliq_vault event: ${problem}`);
    this.name = "VaultEventError";
  }
}

// Returns null for logs that are not fliq_vault events. A fliq_vault event that does not match the frozen
// interface throws: the watcher must alert on it, never skip it.
export function parseVaultEvents(log: string): VaultEvent[] | null {
  if (!log.startsWith(EVENT_PREFIX)) return null;
  const envelope = parseJson(log.slice(EVENT_PREFIX.length));
  if (!isRecord(envelope) || envelope.standard !== VAULT_EVENT_STANDARD) return null;
  if (envelope.version !== VAULT_EVENT_VERSION) {
    throw new VaultEventError(`unsupported version ${String(envelope.version)}`);
  }
  const name = envelope.event;
  if (typeof name !== "string" || !(name in EVENT_FIELDS)) {
    throw new VaultEventError(`unknown event ${String(name)}`);
  }
  if (!Array.isArray(envelope.data) || envelope.data.length === 0) {
    throw new VaultEventError("data must be a non-empty array");
  }
  const fields: Record<string, FieldKind> = EVENT_FIELDS[name as VaultEventName];
  return envelope.data.map((entry) => parseEntry(name, fields, entry) as VaultEvent);
}

export function formatVaultEvent(event: VaultEvent): string {
  const fields: Record<string, FieldKind> = EVENT_FIELDS[event.event];
  const values = event as unknown as Record<string, unknown>;
  const data = Object.fromEntries(
    Object.entries(fields).map(([wire, kind]) => [wire, toWire(kind, values[camel(wire)])]),
  );
  const envelope = {
    standard: VAULT_EVENT_STANDARD,
    version: VAULT_EVENT_VERSION,
    event: event.event,
    data: [data],
  };
  return `${EVENT_PREFIX}${JSON.stringify(envelope)}`;
}

function parseEntry(
  name: string,
  fields: Record<string, FieldKind>,
  entry: unknown,
): Record<string, unknown> {
  if (!isRecord(entry)) throw new VaultEventError(`${name} data entry must be an object`);
  const unexpected = Object.keys(entry).filter((key) => !(key in fields));
  if (unexpected.length > 0)
    throw new VaultEventError(`${name} has unexpected fields ${unexpected.join(", ")}`);
  const parsed: Record<string, unknown> = { event: name };
  for (const [wire, kind] of Object.entries(fields)) {
    parsed[camel(wire)] = fromWire(kind, entry[wire], `${name}.${wire}`);
  }
  return parsed;
}

function fromWire(kind: FieldKind, value: unknown, path: string): unknown {
  switch (kind) {
    case "text":
      if (typeof value !== "string" || value === "")
        throw new VaultEventError(`${path} must be a non-empty string`);
      return value;
    case "u64":
      return unsigned(value, U64_MAX, path);
    case "u128":
      return unsigned(value, U128_MAX, path);
    case "bool":
      if (typeof value !== "boolean") throw new VaultEventError(`${path} must be true or false`);
      return value;
    case "status":
      if (!RECEIPT_STATUSES.includes(value as ReceiptStatus))
        throw new VaultEventError(`${path} is not a status`);
      return value;
    case "refs":
      return refsFromWire(value, path);
    case "corridors":
      return corridorsFromWire(value, path);
  }
}

function toWire(kind: FieldKind, value: unknown): unknown {
  if (kind === "u64" || kind === "u128") return String(value);
  if (kind === "refs") {
    const refs = value as Record<string, string | undefined>;
    return Object.fromEntries(REF_KEYS.flatMap((key) => (refs[camel(key)] ? [[key, refs[camel(key)]]] : [])));
  }
  return value;
}

function unsigned(value: unknown, max: bigint, path: string): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value) || BigInt(value) > max) {
    throw new VaultEventError(`${path} must be an unsigned integer string`);
  }
  return BigInt(value);
}

// Receipts are public, so only the agreed reference keys are accepted; anything else could carry personal data.
function refsFromWire(value: unknown, path: string): ReceiptRefs {
  if (!isRecord(value)) throw new VaultEventError(`${path} must be an object`);
  const refs: Record<string, string> = {};
  for (const [key, ref] of Object.entries(value)) {
    if (!REF_KEYS.includes(key as (typeof REF_KEYS)[number]))
      throw new VaultEventError(`${path}.${key} is not allowed`);
    if (typeof ref !== "string" || !isValidRef(ref))
      throw new VaultEventError(`${path}.${key} must be printable ASCII of 1 to 128 bytes`);
    refs[camel(key)] = ref;
  }
  return refs;
}

// null means the agent may pay into any corridor.
function corridorsFromWire(value: unknown, path: string): readonly string[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.some((corridor) => typeof corridor !== "string" || corridor === "")) {
    throw new VaultEventError(`${path} must be null or a list of corridors`);
  }
  return value as string[];
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new VaultEventError("EVENT_JSON payload is not JSON");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function camel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
