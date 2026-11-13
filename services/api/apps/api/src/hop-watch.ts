import type { OneClickExecution } from "../../../packages/chains/oneclick/types.js";

export type WatchedHop = { payoutId: string; createdAt: Date; validUntil: Date | null };

// 1Click's own guidance is "allow up to 15 minutes"; a healthy swap to Base lands in under a minute.
const HELD_MINUTES = [60, 15, 5] as const;

// Says each thing once per payout, so a poll every 20 s does not repeat itself. 1Click keeps its own deadline
// (days, whatever we ask for), so a swap can still deliver after the provider stopped waiting: that is the "late" line.
export function hopReporter(log: (message: string) => void) {
  const said = new Map<string, string>();
  const once = (payoutId: string, step: string, message: string) => {
    if (said.get(payoutId) === step) return;
    said.set(payoutId, step);
    log(`[hop-watch] ${payoutId}: ${message}`);
  };
  return (hop: WatchedHop, leg: OneClickExecution, now: Date): void => {
    if (leg.status === "SUCCESS") return void said.delete(hop.payoutId);
    if (leg.status === "REFUNDED" || leg.status === "FAILED") {
      const reason = leg.refundReason ? ` (${leg.refundReason.slice(0, 80)})` : "";
      return once(hop.payoutId, leg.status, `1Click ${leg.status} the swap${reason}; the USDC is back in the vault and the provider's order will lapse`);
    }
    // Nothing has reached 1Click: the user has not signed yet, or walked away. No money is waiting.
    if (leg.status === "PENDING_DEPOSIT") return;
    if (hop.validUntil && now > hop.validUntil) {
      return once(hop.payoutId, "late", `1Click has not delivered (${leg.status}) and the provider's window has closed; a late delivery is refunded to the provider refund address and must be moved back by hand`);
    }
    const minutes = Math.floor((now.getTime() - hop.createdAt.getTime()) / 60_000);
    const step = HELD_MINUTES.find((threshold) => minutes >= threshold);
    if (step) once(hop.payoutId, `held${step}`, `held ${minutes} min at 1Click (${leg.status})`);
  };
}
