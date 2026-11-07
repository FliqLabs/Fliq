import { deserialize } from "borsh";
import { SCHEMA } from "near-api-js";
import { RelayerClientError, type RelayerClient, type RelayResponse } from "../../../packages/chains/near/index.js";
import { VaultError } from "../../../packages/chains/vault/index.js";
import { newId } from "../../../packages/db/src/ids.js";
import type { Db, Unit } from "./db.js";
import { ApiError, invalidRequest, notFound } from "./errors.js";
import type { Reply } from "./idempotency.js";
import { recordObservedTransfer } from "./people.js";

type DelegateCall = { receiverId: string; method: string; args: Record<string, unknown> };
type Decoded = { sender: string; call: DelegateCall | null };

function decodeDelegate(signedDelegateBase64: string): Decoded | null {
  try {
    const decoded = deserialize(SCHEMA.SignedDelegate, Buffer.from(signedDelegateBase64, "base64")) as {
      delegateAction?: { senderId?: unknown; receiverId?: unknown; actions?: { functionCall?: { methodName?: unknown; args?: Uint8Array } }[] };
    };
    const action = decoded.delegateAction;
    if (typeof action?.senderId !== "string" || action.senderId.length === 0) return null;
    const call = action.actions?.[0]?.functionCall;
    let args: Record<string, unknown> = {};
    try {
      args = call?.args ? (JSON.parse(Buffer.from(call.args).toString("utf8")) as Record<string, unknown>) : {};
    } catch {
      args = {};
    }
    return {
      sender: action.senderId,
      call: call && typeof call.methodName === "string" ? { receiverId: String(action.receiverId), method: call.methodName, args } : null,
    };
  } catch {
    return null;
  }
}

// Who signed the delegate. The relayer checks the signature itself; this only stops a user relaying for someone else.
export function delegateSender(signedDelegateBase64: string): string | null {
  return decodeDelegate(signedDelegateBase64)?.sender ?? null;
}

const REFUSALS = new Set(["POLICY_DAILY_CAP", "POLICY_PER_PAYOUT_CAP", "POLICY_CORRIDOR", "POLICY_COOLDOWN", "POLICY_EXPIRED", "POLICY_REVOKED"]);

// A transfer between two vaults is recorded once the chain ran it; an agent payout the vault refused is recorded
// because nothing moved and nothing else would show it.
async function recordOutcome(tx: Db, userId: string, delegate: Decoded, result: RelayResponse, vaultAccount: string): Promise<void> {
  const call = delegate.call;
  if (!call || call.receiverId !== vaultAccount) return;
  if (call.method === "transfer" && result.status === "succeeded" && result.tx_hash) {
    const amount = String(call.args.amount ?? "");
    if (/^[1-9]\d*$/.test(amount)) await recordObservedTransfer(tx, { txHash: result.tx_hash, from: delegate.sender, to: String(call.args.to_account), amount: BigInt(amount) });
    return;
  }
  if (call.method !== "payout" || result.status !== "failed") return;
  const code = VaultError.fromPanic(result.failures.join(" "))?.code;
  if (!code || !REFUSALS.has(code)) return;
  const agent = await tx.agent.findFirst({ where: { id: delegate.sender, userId } });
  if (!agent) return;
  const payout = await tx.payout.findUnique({ where: { id: String(call.args.order_id ?? "") }, select: { amountOutMinor: true, currency: true } });
  await tx.agentRefusal.create({
    data: {
      id: newId("ref"),
      userId,
      agentId: agent.id,
      reason: code,
      amountMinor: payout?.amountOutMinor ?? null,
      currency: payout?.currency.toUpperCase() ?? null,
      orderId: typeof call.args.order_id === "string" ? call.args.order_id : null,
      txHash: result.tx_hash ?? null,
    },
  });
}

const unavailable = () => new ApiError(503, "chain_unavailable", "Sending to NEAR is not available right now. Try again in a moment.");

async function accountOf(unit: Unit, userId: string): Promise<string> {
  const user = await unit((tx) => tx.user.findUnique({ where: { id: userId }, select: { nearAccount: true } }));
  if (!user?.nearAccount) throw notFound("Claim a fliq name to get a NEAR account.");
  return user.nearAccount;
}

const answer = (result: RelayResponse): Reply => ({ status: result.status === "pending" ? 202 : 200, body: result });

// The relayer's errors already have the API's error shape, so they go back to the app as they are. An unreachable
// relayer, or one refusing our token, is our fault, not the user's, and reads as unavailable.
function relayerFailure(error: unknown): Reply {
  if (!(error instanceof RelayerClientError)) throw error;
  if (error.status === 0 || error.status === 401) throw unavailable();
  return { status: error.status, body: { error: { code: error.code, message: error.message } } };
}

// The sender is the user's own account or one of the user's agents, so nobody can relay for someone else.
// An agent calling for itself passes onlySender, so it can relay its own delegates and no one else's.
export async function relayDelegate(unit: Unit, relayer: RelayerClient | undefined, userId: string, signedDelegate: string, vaultAccount: string, onlySender?: string): Promise<Reply> {
  const account = await accountOf(unit, userId);
  const delegate = decodeDelegate(signedDelegate);
  if (!delegate) throw invalidRequest("signed_delegate is not a base64 Borsh SignedDelegate.");
  if (onlySender !== undefined && delegate.sender !== onlySender) throw new ApiError(403, "forbidden", "An agent can only relay what it signed itself.");
  const ownAgent = delegate.sender === account ? null : await unit((tx) => tx.agent.findFirst({ where: { id: delegate.sender, userId, state: { not: "revoked" } }, select: { id: true } }));
  if (delegate.sender !== account && !ownAgent) throw new ApiError(403, "forbidden", "The delegate must be signed by your own NEAR account or one of your agents.");
  if (!relayer) throw unavailable();
  let result: RelayResponse;
  try {
    result = await relayer.relay(signedDelegate);
  } catch (error) {
    return relayerFailure(error);
  }
  await unit((tx) => recordOutcome(tx, userId, delegate, result, vaultAccount));
  return answer(result);
}

export async function getRelay(unit: Unit, relayer: RelayerClient | undefined, userId: string, delegateHash: string): Promise<Reply> {
  const account = await accountOf(unit, userId);
  if (!relayer) throw unavailable();
  let result: RelayResponse;
  try {
    result = await relayer.relayStatus(delegateHash);
  } catch (error) {
    if (error instanceof RelayerClientError && error.status === 404) throw notFound("No such relay.");
    return relayerFailure(error);
  }
  if (result.sender_id !== account) throw notFound("No such relay.");
  return { status: 200, body: result };
}
