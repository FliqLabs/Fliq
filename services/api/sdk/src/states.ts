import type { PayoutState } from "./types.js";

export const PAYOUT_STATES = [
  "created",
  "provider_timeout",
  "awaiting_recon",
  "awaiting_deposit",
  "deposit_seen",
  "routing",
  "with_provider",
  "paying_out",
  "settled",
  "refunding",
  "refunded",
  "expired",
  "failed",
  "refused",
  "not_received",
] as const satisfies readonly PayoutState[];

// not_received follows a settled payout whose credit never landed; it is resolved by support, not by polling.
export const FINAL_PAYOUT_STATES: ReadonlySet<PayoutState> = new Set([
  "settled",
  "refunded",
  "expired",
  "failed",
  "refused",
  "not_received",
]);

export function isFinalState(state: PayoutState): boolean {
  return FINAL_PAYOUT_STATES.has(state);
}
