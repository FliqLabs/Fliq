import { readResponse } from "../../../sdk/src/client.js";
import {
  FliqError,
  type AgentPayout,
  type AgentQuoteRequest,
  type AgentSelf,
  type Payout,
  type Quote,
  type RecipientList,
  type RelayResult,
  type SignStep,
} from "../../../sdk/src/index.js";
import { base58Encode } from "./base58.js";
import { publicKeyText, signDelegate, type AgentKey } from "./delegate.js";

export interface AgentClientOptions {
  // Ends in /v1, like FLIQ_API_URL. The signature covers the path as the API sees it, /v1 included.
  baseUrl: string;
  key: AgentKey;
  nearRpcUrl: string;
  fetch?: typeof fetch;
  now?: () => number;
}

// The relayer refuses a delegate more than 1,200 blocks ahead; 120 blocks is about two minutes.
const VALIDITY_BLOCKS = 120n;

type Method = "GET" | "POST";

// Talks to /v1/agent/* as a NEAR agent: every request is signed with the agent's own key, no API key involved.
export class AgentClient {
  readonly baseUrl: string;
  readonly accountId: string;
  private readonly key: AgentKey;
  private readonly nearRpcUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;

  constructor(options: AgentClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.key = options.key;
    this.accountId = options.key.accountId;
    this.nearRpcUrl = options.nearRpcUrl;
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? Date.now;
  }

  self(): Promise<AgentSelf> {
    return this.request<AgentSelf>("GET", "/agent");
  }

  recipients(): Promise<RecipientList> {
    return this.request<RecipientList>("GET", "/agent/recipients");
  }

  quote(input: AgentQuoteRequest): Promise<Quote> {
    return this.request<Quote>("POST", "/agent/quotes", input);
  }

  createPayout(
    input: { quote_id: string; recipient_id: string },
    idempotencyKey: string,
  ): Promise<AgentPayout> {
    return this.request<AgentPayout>("POST", "/agent/payouts", input, { "idempotency-key": idempotencyKey });
  }

  getPayout(payoutId: string): Promise<Payout> {
    return this.request<Payout>("GET", `/agent/payouts/${encodeURIComponent(payoutId)}`);
  }

  relay(signedDelegate: string): Promise<RelayResult> {
    return this.request<RelayResult>("POST", "/agent/relays", { signed_delegate: signedDelegate });
  }

  // Signs the step exactly as the API described it, so the vault sees the call the API checked against the limits.
  async signStep(step: SignStep): Promise<string> {
    if (step.kind !== "function_call" || !step.method_name || !step.gas) {
      throw new Error(`The API asked for a ${step.kind} step, which an agent cannot sign.`);
    }
    const access = await this.viewAccessKey();
    const { signedDelegate } = await signDelegate(this.key, {
      call: {
        receiverId: step.receiver_id,
        methodName: step.method_name,
        args: step.args ?? {},
        gas: BigInt(step.gas),
        deposit: BigInt(step.deposit),
      },
      nonce: access.nonce + 1n,
      maxBlockHeight: access.blockHeight + VALIDITY_BLOCKS,
    });
    return signedDelegate;
  }

  private async request<T>(
    method: Method,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    const raw = body === undefined ? "" : JSON.stringify(body);
    const timestamp = String(Math.floor(this.now() / 1000));
    const message = await signedMessage(method, `${url.pathname}${url.search}`, timestamp, raw);
    const signature = base58Encode(await this.key.sign(new TextEncoder().encode(message)));
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method,
        headers: {
          accept: "application/json",
          ...(raw ? { "content-type": "application/json" } : {}),
          "x-fliq-agent": this.accountId,
          "x-fliq-timestamp": timestamp,
          "x-fliq-signature": signature,
          ...headers,
        },
        body: raw || undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The request could not be sent.";
      throw new FliqError({ status: 0, code: "network_error", message });
    }
    return readResponse<T>(response);
  }

  private async viewAccessKey(): Promise<{ nonce: bigint; blockHeight: bigint }> {
    const response = await this.fetcher(this.nearRpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "fliq-mcp",
        method: "query",
        params: {
          request_type: "view_access_key",
          finality: "final",
          account_id: this.accountId,
          public_key: publicKeyText(this.key.publicKey),
        },
      }),
    });
    const answer = (await response.json().catch(() => null)) as {
      result?: { nonce?: number | string; block_height?: number | string; error?: string };
    } | null;
    const result = answer?.result;
    if (
      !response.ok ||
      !result ||
      result.error ||
      result.nonce === undefined ||
      result.block_height === undefined
    ) {
      throw new Error("The agent key is not on the agent account, or the NEAR RPC did not answer.");
    }
    return { nonce: BigInt(result.nonce), blockHeight: BigInt(result.block_height) };
  }
}

// The same string the API's agent-auth.ts verifies: method, path with query, unix seconds, sha256 hex of the body.
export async function signedMessage(
  method: string,
  pathWithQuery: string,
  timestamp: string,
  rawBody: string,
): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawBody));
  const bodyHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [method.toUpperCase(), pathWithQuery, timestamp, bodyHash].join("\n");
}
