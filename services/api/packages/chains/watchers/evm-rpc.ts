// keccak256("Transfer(address,address,uint256)"), the ERC-20 Transfer event signature.
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const HEX = /^0x[0-9a-f]*$/i;
const DEFAULT_TIMEOUT_MS = 5_000;

export type EvmBlock = { number: bigint; hash: string; timestamp: Date };

export type EvmTransferLog = {
  token: string;
  from: string;
  to: string;
  amount: bigint;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockHash: string;
  removed: boolean;
};

export type TransferQuery = {
  fromBlock: bigint;
  toBlock: bigint;
  tokens: readonly string[];
  recipients: readonly string[];
};

export interface EvmRpc {
  blockNumber(): Promise<bigint>;
  block(number: bigint): Promise<EvmBlock | null>;
  transferLogs(query: TransferQuery): Promise<EvmTransferLog[]>;
}

export type RpcErrorKind = "unavailable" | "rpc_error" | "invalid_response";

// The RPC URL often embeds a provider key, so it never appears in a message.
export class RpcError extends Error {
  readonly kind: RpcErrorKind;

  constructor(method: string, kind: RpcErrorKind, detail: string) {
    super(`${method} ${kind}: ${detail}`);
    this.name = "RpcError";
    this.kind = kind;
  }
}

export type EvmRpcOptions = { url: string; fetch?: typeof fetch; timeoutMs?: number };

export function createEvmRpc(options: EvmRpcOptions): EvmRpc {
  const doFetch = options.fetch ?? fetch;
  let id = 0;

  async function call(method: string, params: unknown[]): Promise<unknown> {
    id += 1;
    let response: Response;
    try {
      response = await doFetch(options.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch {
      throw new RpcError(method, "unavailable", "no response");
    }
    if (!response.ok) throw new RpcError(method, "unavailable", `HTTP ${response.status}`);
    const body = (await response.json().catch(() => null)) as {
      result?: unknown;
      error?: { message?: unknown };
    } | null;
    if (!body) throw new RpcError(method, "invalid_response", "body is not JSON");
    if (body.error)
      throw new RpcError(method, "rpc_error", String(body.error.message ?? "error").slice(0, 200));
    return body.result;
  }

  return {
    async blockNumber() {
      return quantity("eth_blockNumber", await call("eth_blockNumber", []));
    },
    async block(number) {
      const result = await call("eth_getBlockByNumber", [toHex(number), false]);
      if (result === null) return null;
      const block = object("eth_getBlockByNumber", result);
      return {
        number: quantity("eth_getBlockByNumber", block.number),
        hash: hash("eth_getBlockByNumber", block.hash),
        timestamp: new Date(Number(quantity("eth_getBlockByNumber", block.timestamp)) * 1000),
      };
    },
    async transferLogs(query) {
      const filter = {
        fromBlock: toHex(query.fromBlock),
        toBlock: toHex(query.toBlock),
        address: [...query.tokens],
        topics: [TRANSFER_TOPIC, null, query.recipients.map(addressTopic)],
      };
      const result = await call("eth_getLogs", [filter]);
      if (!Array.isArray(result)) throw new RpcError("eth_getLogs", "invalid_response", "expected an array");
      return result.map(parseTransferLog);
    },
  };
}

function parseTransferLog(value: unknown): EvmTransferLog {
  const log = object("eth_getLogs", value);
  const topics = log.topics;
  if (!Array.isArray(topics) || topics.length !== 3 || String(topics[0]).toLowerCase() !== TRANSFER_TOPIC) {
    throw new RpcError("eth_getLogs", "invalid_response", "not an ERC-20 Transfer log");
  }
  const data = hash("eth_getLogs", log.data);
  if (data.length !== 66)
    throw new RpcError("eth_getLogs", "invalid_response", "Transfer data must be one 32-byte word");
  return {
    token: hash("eth_getLogs", log.address).toLowerCase(),
    from: topicAddress(topics[1]),
    to: topicAddress(topics[2]),
    amount: BigInt(data),
    txHash: hash("eth_getLogs", log.transactionHash),
    logIndex: Number(quantity("eth_getLogs", log.logIndex)),
    blockNumber: quantity("eth_getLogs", log.blockNumber),
    blockHash: hash("eth_getLogs", log.blockHash),
    removed: log.removed === true,
  };
}

export function addressTopic(address: string): string {
  return `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

function topicAddress(topic: unknown): string {
  const value = hash("eth_getLogs", topic);
  return `0x${value.slice(-40).toLowerCase()}`;
}

function toHex(value: bigint): string {
  return `0x${value.toString(16)}`;
}

function quantity(method: string, value: unknown): bigint {
  if (typeof value !== "string" || !HEX.test(value) || value.length < 3) {
    throw new RpcError(method, "invalid_response", "expected a hex quantity");
  }
  return BigInt(value);
}

function hash(method: string, value: unknown): string {
  if (typeof value !== "string" || !HEX.test(value))
    throw new RpcError(method, "invalid_response", "expected hex data");
  return value;
}

function object(method: string, value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RpcError(method, "invalid_response", "expected an object");
  }
  return value as Record<string, unknown>;
}
