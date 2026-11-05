import { account, type AccountRef, type Asset } from "./accounts.js";

export type PostingType =
  | "ORDER_COMMITTED"
  | "DEPOSIT_RECEIVED"
  | "IN_TRANSIT"
  | "DELIVERED_TO_PROVIDER"
  | "SETTLED"
  | "FEE_COLLECTED"
  | "REFUND_INITIATED"
  | "REFUND_COMPLETED"
  | "VAULT_CREDITED"
  | "VAULT_TRANSFER"
  | "VAULT_RESERVED"
  | "VAULT_RELEASED";

export interface Line {
  account: AccountRef;
  // Signed token base units: debit positive, credit negative, so an entry balances when its lines sum to zero.
  amount: bigint;
}

export interface Posting {
  payoutId: string;
  type: PostingType;
  lines: Line[];
  memo?: Record<string, string | number>;
}

export interface PayoutAmounts {
  payoutId: string;
  provider: string;
  asset: Asset;
  // What the sender pays, our routing fee inside it, and the chain and 1Click fees taken on an Intents hop.
  gross: bigint;
  routingFee: bigint;
  networkFee: bigint;
}

const debit = (ref: AccountRef, amount: bigint): Line => ({ account: ref, amount });
const credit = (ref: AccountRef, amount: bigint): Line => ({ account: ref, amount: -amount });

function names(amounts: PayoutAmounts) {
  const { asset, provider } = amounts;
  return {
    senderExternal: account("sender_external", asset),
    escrow: account("provider_escrow", asset, provider),
    revenue: account("fee_revenue", asset),
    inFlight: account("intents_in_flight", asset),
    networkFees: account("network_fees", asset),
    recipientPaid: account("recipient_paid", asset),
    feeReceivable: account("fee_receivable", asset, provider),
    feeWallet: account("fee_wallet", asset),
    refundInFlight: account("refund_in_flight", asset),
  };
}

// Spec 6.1: the commitment is memo only on a direct route. Nothing moves until the deposit is seen.
export function orderCommitted(amounts: PayoutAmounts, memo: Record<string, string | number>): Posting {
  return { payoutId: amounts.payoutId, type: "ORDER_COMMITTED", lines: [], memo };
}

export function depositReceived(amounts: PayoutAmounts): Posting {
  const a = names(amounts);
  return {
    payoutId: amounts.payoutId,
    type: "DEPOSIT_RECEIVED",
    lines: [
      debit(a.escrow, amounts.gross),
      credit(a.senderExternal, amounts.gross - amounts.routingFee),
      credit(a.revenue, amounts.routingFee),
    ],
  };
}

export function inTransit(amounts: PayoutAmounts): Posting {
  const a = names(amounts);
  return {
    payoutId: amounts.payoutId,
    type: "IN_TRANSIT",
    lines: [
      debit(a.inFlight, amounts.gross),
      credit(a.senderExternal, amounts.gross - amounts.routingFee),
      credit(a.revenue, amounts.routingFee),
    ],
  };
}

export function deliveredToProvider(amounts: PayoutAmounts): Posting {
  const a = names(amounts);
  return {
    payoutId: amounts.payoutId,
    type: "DELIVERED_TO_PROVIDER",
    lines: [
      debit(a.escrow, amounts.gross - amounts.networkFee),
      debit(a.networkFees, amounts.networkFee),
      credit(a.inFlight, amounts.gross),
    ],
  };
}

export function settled(amounts: PayoutAmounts, memo: Record<string, string | number>): Posting {
  const a = names(amounts);
  const held = amounts.gross - amounts.networkFee;
  return {
    payoutId: amounts.payoutId,
    type: "SETTLED",
    lines: [debit(a.recipientPaid, held - amounts.routingFee), debit(a.feeReceivable, amounts.routingFee), credit(a.escrow, held)],
    memo,
  };
}

export function feeCollected(amounts: PayoutAmounts): Posting {
  const a = names(amounts);
  return {
    payoutId: amounts.payoutId,
    type: "FEE_COLLECTED",
    lines: [debit(a.feeWallet, amounts.routingFee), credit(a.feeReceivable, amounts.routingFee)],
  };
}

// Together the two refund postings equal spec 6.3's REFUND row: they reverse the deposit entry,
// with the money held as refund_in_flight until the refund is confirmed.
export function refundInitiated(amounts: PayoutAmounts): Posting {
  const a = names(amounts);
  const held = amounts.gross - amounts.networkFee;
  return {
    payoutId: amounts.payoutId,
    type: "REFUND_INITIATED",
    lines: [debit(a.senderExternal, held - amounts.routingFee), debit(a.revenue, amounts.routingFee), credit(a.refundInFlight, held)],
  };
}

export function refundCompleted(amounts: PayoutAmounts): Posting {
  const a = names(amounts);
  const held = amounts.gross - amounts.networkFee;
  return { payoutId: amounts.payoutId, type: "REFUND_COMPLETED", lines: [debit(a.refundInFlight, held), credit(a.escrow, held)] };
}

// Vault routes reserve the funding balance so the same funds cannot back two payouts.
export function vaultReserved(payoutId: string, holder: string, asset: Asset, amount: bigint): Posting {
  return {
    payoutId,
    type: "VAULT_RESERVED",
    lines: [debit(account("vault_available", asset, holder), amount), credit(account("vault_reserved", asset, holder), amount)],
  };
}

export function vaultReleased(payoutId: string, holder: string, asset: Asset, amount: bigint): Posting {
  return {
    payoutId,
    type: "VAULT_RELEASED",
    lines: [debit(account("vault_reserved", asset, holder), amount), credit(account("vault_available", asset, holder), amount)],
  };
}

// A confirmed on-chain credit to the user's vault mirrors into vault_available; top-ups and recredits use it.
export function vaultCredited(creditId: string, holder: string, asset: Asset, amount: bigint): Posting {
  return {
    payoutId: creditId,
    type: "VAULT_CREDITED",
    lines: [debit(account("sender_external", asset), amount), credit(account("vault_available", asset, holder), amount)],
  };
}

// A vault-to-vault transfer moves the amount between two holders' free balances.
export function vaultTransfer(transferId: string, from: string, to: string, asset: Asset, amount: bigint): Posting {
  return {
    payoutId: transferId,
    type: "VAULT_TRANSFER",
    lines: [debit(account("vault_available", asset, from), amount), credit(account("vault_available", asset, to), amount)],
  };
}
