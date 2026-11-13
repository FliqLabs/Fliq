import { deserialize } from "borsh";
import { SCHEMA } from "near-api-js";
import { RelayerClientError, type RelayerClient, type RelayResponse } from "../../../packages/chains/near/index.js";
import { VaultError } from "../../../packages/chains/vault/index.js";
import { newId } from "../../../packages/db/src/ids.js";
import type { Db, Unit } from "./db.js";
import { ApiError, invalidRequest, notFound } from "./errors.js";
import type { Reply } from "./idempotency.js";
import { recordObservedTransfer, recordOutsideSend } from "./people.js";

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

export type RelayContracts = { vault: string; usdc: string };

const UNITS = /^[1-9]\d*$/;

// USDC the user moves from their own NEAR account into the vault never passes through 1Click, so nothing else
// records it. It shows in Activity as a deposit from NEAR, once per transaction however often the relay is replayed.
// deposit_address is unique per row, so the row is keyed by its transaction rather than by the vault.
async function recordDirectTopUp(tx: Db, userId: string, delegate: Decoded, txHash: string): Promise<void> {
  const amount = String(delegate.call?.args.amount ?? "");
  if (!UNITS.test(amount)) return;
  if (await tx.vaultDeposit.findFirst({ where: { originTx: txHash }, select: { id: true } })) return;
  const units = BigInt(amount);
  const at = new Date();
  await tx.vaultDeposit.create({
    data: {
      id: newId("dep"),
      userId,
      account: delegate.sender,
      token: "usdc",
      chain: "near",
      decimals: 6,
      depositAddress: `near:${txHash}`,
      amountUnits: units,
      minimumUnits: units,
      feeMicroUsd: 0n,
      landsUnits: units,
      etaSeconds: 0,
      reservedUntil: at,
      state: "landed",
      receivedUnits: units,
      landedUnits: units,
      originTx: txHash,
      seenAt: at,
      landedAt: at,
      quote: { source: "direct" },
    },
  });
}

const isDirectTopUp = (call: DelegateCall, contracts: RelayContracts) =>
  call.receiverId === contracts.usdc && call.method === "ft_transfer_call" && call.args.receiver_id === contracts.vault && call.args.msg === "";

// The last step of a send to a NEAR wallet outside fliq. Like a direct top-up, nothing else records it.
const isOutsideSend = (call: DelegateCall, contracts: RelayContracts) => call.receiverId === contracts.usdc && call.method === "ft_transfer";

// A transfer between two vaults is recorded once the chain ran it; an agent payout the vault refused is recorded
// because nothing moved and nothing else would show it.
async function recordOutcome(tx: Db, userId: string, delegate: Decoded, result: RelayResponse, contracts: RelayContracts): Promise<void> {
  const call = delegate.call;
  if (call && isDirectTopUp(call, contracts)) {
    if (result.status === "succeeded" && result.tx_hash) await recordDirectTopUp(tx, userId, delegate, result.tx_hash);
    return;
  }
  if (call && isOutsideSend(call, contracts)) {
    const amount = String(call.args.amount ?? "");
    if (result.status === "succeeded" && result.tx_hash && UNITS.test(amount))
      await recordOutsideSend(tx, userId, { txHash: result.tx_hash, from: delegate.sender, to: String(call.args.receiver_id), amount: BigInt(amount) });
    return;
  }
  if (!call || call.receiverId !== contracts.vault) return;
  if (call.method === "transfer" && result.status === "succeeded" && result.tx_hash) {
    const amount = String(call.args.amount ?? "");
    if (UNITS.test(amount)) await recordObservedTransfer(tx, { txHash: result.tx_hash, from: delegate.sender, to: String(call.args.to_account), amount: BigInt(amount) });
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
export async function relayDelegate(unit: Unit, relayer: RelayerClient | undefined, userId: string, signedDelegate: string, contracts: RelayContracts, onlySender?: string): Promise<Reply> {
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
  await unit((tx) => recordOutcome(tx, userId, delegate, result, contracts));
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
