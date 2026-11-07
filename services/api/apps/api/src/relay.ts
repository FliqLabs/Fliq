import { deserialize } from "borsh";
import { SCHEMA } from "near-api-js";
import { RelayerClientError, type RelayerClient, type RelayResponse } from "../../../packages/chains/near/index.js";
import type { Unit } from "./db.js";
import { ApiError, invalidRequest, notFound } from "./errors.js";
import type { Reply } from "./idempotency.js";

// Who signed the delegate. The relayer checks the signature itself; this only stops a user relaying for someone else.
export function delegateSender(signedDelegateBase64: string): string | null {
  try {
    const bytes = Buffer.from(signedDelegateBase64, "base64");
    const decoded = deserialize(SCHEMA.SignedDelegate, bytes) as { delegateAction?: { senderId?: unknown } };
    const sender = decoded.delegateAction?.senderId;
    return typeof sender === "string" && sender.length > 0 ? sender : null;
  } catch {
    return null;
  }
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

export async function relayDelegate(unit: Unit, relayer: RelayerClient | undefined, userId: string, signedDelegate: string): Promise<Reply> {
  const account = await accountOf(unit, userId);
  const sender = delegateSender(signedDelegate);
  if (!sender) throw invalidRequest("signed_delegate is not a base64 Borsh SignedDelegate.");
  if (sender !== account) throw new ApiError(403, "forbidden", "The delegate must be signed by your own NEAR account.");
  if (!relayer) throw unavailable();
  try {
    return answer(await relayer.relay(signedDelegate));
  } catch (error) {
    return relayerFailure(error);
  }
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
