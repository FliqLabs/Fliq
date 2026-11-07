import { actions, baseEncode, buildDelegateAction, encodeSignedDelegate, KeyPair, KeyPairSigner } from "near-api-js";
import { signedMessage } from "../../api/src/agent-auth.js";
import type { NearRpc } from "../../../packages/chains/near/index.js";

// A delegate stays valid for this many blocks, about ten minutes; the relayer refuses more than 1,200.
const DELEGATE_LIFETIME_BLOCKS = 600n;

export type SignStep = {
  kind: string;
  receiver_id: string;
  method_name: string | null;
  args: Record<string, unknown> | null;
  gas: string | null;
  deposit: string;
};

export type AgentCredentials = {
  // The API's origin, for example https://fliq-yclq.onrender.com. Paths are signed as the API sees them, from /v1.
  apiUrl: string;
  agentId: string;
  privateKey: string;
  rpc: NearRpc;
};

export type ApiAnswer = { status: number; body: unknown };

export class AgentClient {
  readonly #credentials: AgentCredentials;
  readonly #key: KeyPair;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;

  constructor(credentials: AgentCredentials, options: { fetch?: typeof fetch; now?: () => number } = {}) {
    this.#credentials = { ...credentials, apiUrl: credentials.apiUrl.replace(/\/+$/, "") };
    this.#key = KeyPair.fromString(credentials.privateKey as Parameters<typeof KeyPair.fromString>[0]);
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
  }

  get publicKey(): string {
    return this.#key.getPublicKey().toString();
  }

  // Every request carries the agent's signature over the method, path, time and the exact body sent.
  async request(method: "GET" | "POST", path: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiAnswer> {
    const raw = body === undefined ? "" : JSON.stringify(body);
    const timestamp = String(Math.floor(this.#now() / 1000));
    const signature = baseEncode(this.#key.sign(new TextEncoder().encode(signedMessage(method, path, timestamp, raw))).signature);
    const response = await this.#fetch(`${this.#credentials.apiUrl}${path}`, {
      method,
      headers: {
        ...(raw ? { "content-type": "application/json" } : {}),
        "x-fliq-agent": this.#credentials.agentId,
        "x-fliq-timestamp": timestamp,
        "x-fliq-signature": signature,
        ...headers,
      },
      ...(raw ? { body: raw } : {}),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  // The vault only pays when the agent's own account signs, so the payout call is signed here and relayed.
  async signAndRelay(step: SignStep): Promise<ApiAnswer> {
    if (step.kind !== "function_call" || !step.method_name || !step.gas) throw new Error(`cannot sign a ${step.kind} step`);
    const { rpc, agentId } = this.#credentials;
    const [access, block] = await Promise.all([rpc.accessKey(agentId, this.publicKey), rpc.finalBlock()]);
    if (!access) throw new Error(`${this.publicKey} is not a key of ${agentId}`);
    const delegate = buildDelegateAction({
      senderId: agentId,
      receiverId: step.receiver_id,
      actions: [actions.functionCall(step.method_name, step.args ?? {}, BigInt(step.gas), BigInt(step.deposit))],
      nonce: access.nonce + 1n,
      maxBlockHeight: block.height + DELEGATE_LIFETIME_BLOCKS,
      publicKey: this.#key.getPublicKey(),
    });
    const { signedDelegate } = await new KeyPairSigner(this.#key).signDelegateAction(delegate);
    const signed = Buffer.from(encodeSignedDelegate(signedDelegate)).toString("base64");
    return this.request("POST", "/v1/agent/relays", { signed_delegate: signed });
  }
}
