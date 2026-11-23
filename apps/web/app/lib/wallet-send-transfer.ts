import { signAndRelay } from "./device-signer";
import { ApiError } from "./fliq-api";
import { stepAction } from "./near-delegate";
import { toTokenUnits } from "./money";
import type { User } from "./wallet-api";

const rpcUrl = process.env.NEXT_PUBLIC_NEAR_RPC_URL ?? "https://rpc.mainnet.fastnear.com";

export class SendNeedsReviewError extends Error {}

export class OnwardTransferError extends SendNeedsReviewError {
  constructor() {
    super(
      "The vault withdrawal succeeded, but the onward transfer did not. Your USDC is in your own NEAR account. Check Activity before sending again.",
    );
  }
}

async function rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "fliq-send", method, params }),
  });
  if (!response.ok) throw new Error("NEAR is unavailable. Try again in a moment.");
  const body = await response.json();
  if (body.error || body.result?.error) throw new Error("NEAR could not check this wallet.");
  return body.result as T;
}

async function view<T>(account: string, method: string, args: Record<string, unknown>): Promise<T> {
  const bytes = new TextEncoder().encode(JSON.stringify(args));
  const encoded = btoa(String.fromCharCode(...bytes));
  const result = await rpc<{ result: number[] }>("query", {
    request_type: "call_function",
    finality: "final",
    account_id: account,
    method_name: method,
    args_base64: encoded,
  });
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(result.result))) as T;
}

export async function sendFromVault(user: User, address: string, amount: string, onSubmitted: () => void) {
  if (!user.vault || !user.near_account) throw new Error("Your vault is not ready to send.");
  if (!/^[0-9a-f]{64}$/.test(address)) {
    await rpc("query", { request_type: "view_account", finality: "final", account_id: address });
  }
  const vault = user.vault;
  const units = toTokenUnits(amount).toString();
  const config = await view<{ approved_usdc_token_contract: string }>(vault, "get_config", {});
  const usdc = config.approved_usdc_token_contract;
  const registered = await view<null | { total: string }>(usdc, "storage_balance_of", {
    account_id: address,
  });

  let withdrawSubmitted = false;
  try {
    await signAndRelay(
      user,
      (signer) =>
        stepAction(signer, {
          kind: "function_call",
          receiver_id: vault,
          method_name: "withdraw",
          args: { amount: units },
          gas: "90000000000000",
          deposit: "1",
          public_key: null,
        }),
      () => {
        withdrawSubmitted = true;
      },
    );
  } catch (error) {
    if (withdrawSubmitted)
      throw new SendNeedsReviewError(
        "The vault withdrawal was submitted to NEAR. Check Activity before trying again.",
      );
    throw error;
  }

  let onwardSubmitted = false;
  try {
    if (!registered) {
      const bounds = await view<{ min: string }>(usdc, "storage_balance_bounds", {});
      await signAndRelay(user, (signer) =>
        stepAction(signer, {
          kind: "function_call",
          receiver_id: usdc,
          method_name: "storage_deposit",
          args: { account_id: address, registration_only: true },
          gas: "10000000000000",
          deposit: bounds.min,
          public_key: null,
        }),
      );
    }

    return await signAndRelay(
      user,
      (signer) =>
        stepAction(signer, {
          kind: "function_call",
          receiver_id: usdc,
          method_name: "ft_transfer",
          args: { receiver_id: address, amount: units, memo: "fliq" },
          gas: "20000000000000",
          deposit: "1",
          public_key: null,
        }),
      () => {
        onwardSubmitted = true;
        onSubmitted();
      },
    );
  } catch (error) {
    if (onwardSubmitted)
      throw new SendNeedsReviewError(
        "The transfer was submitted to NEAR. Check Activity for its final status before trying again.",
      );
    if (error instanceof ApiError && error.code === "daily_limit") throw error;
    throw new OnwardTransferError();
  }
}
