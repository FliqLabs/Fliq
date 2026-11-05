import {
  LATE_DEPOSIT_WINDOW_MS,
  type DepositObserved,
  type PaymentMatch,
  type TokenTransfer,
  type Watch,
} from "./types";

export function isWatchOpen(watch: Watch, now: Date): boolean {
  return now.getTime() <= watch.expiresAt.getTime() + LATE_DEPOSIT_WINDOW_MS;
}

export function eventIdOf(transfer: TokenTransfer): string {
  return `${key(transfer.chain, transfer.txHash)}:${transfer.index}`;
}

export function paymentMatch(totalReceived: bigint, expected: bigint): PaymentMatch {
  if (totalReceived < expected) return "underpaid";
  return totalReceived === expected ? "exact" : "overpaid";
}

// Turns transfers into observations for the watches they pay. Several transfers to one address add up, so a
// split payment reads underpaid, then exact. Transfers in a different asset, to no open watch, or already
// committed (counted in watch.received) are skipped.
export function observe(
  watches: readonly Watch[],
  transfers: readonly TokenTransfer[],
  committed: ReadonlySet<string> = new Set(),
): DepositObserved[] {
  const byAddress = new Map(watches.map((watch) => [key(watch.chain, watch.address), watch]));
  const running = new Map(watches.map((watch) => [watch.id, watch.received]));
  const seen = new Set<string>();
  const ordered = [...transfers].sort((a, b) => compare(a.position, b.position) || a.index - b.index);
  const observations: DepositObserved[] = [];

  for (const transfer of ordered) {
    const watch = byAddress.get(key(transfer.chain, transfer.to));
    const eventId = eventIdOf(transfer);
    if (!watch || watch.asset !== transfer.asset || transfer.amount <= 0n) continue;
    if (seen.has(eventId) || committed.has(eventId)) continue;
    seen.add(eventId);
    const totalReceived = (running.get(watch.id) ?? 0n) + transfer.amount;
    running.set(watch.id, totalReceived);
    observations.push({
      type: "deposit.observed",
      eventId,
      watchId: watch.id,
      chain: transfer.chain,
      asset: transfer.asset,
      address: watch.address,
      from: transfer.from,
      txHash: transfer.txHash,
      position: transfer.position,
      at: transfer.at,
      amount: transfer.amount,
      totalReceived,
      expected: watch.expected,
      payment: paymentMatch(totalReceived, watch.expected),
      late: transfer.at.getTime() > watch.expiresAt.getTime(),
    });
  }
  return observations;
}

// EVM addresses and hashes are case-insensitive hex; Solana's are case-sensitive base58.
function key(chain: string, value: string): string {
  return chain === "solana" ? `${chain}:${value}` : `${chain}:${value.toLowerCase()}`;
}

function compare(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
