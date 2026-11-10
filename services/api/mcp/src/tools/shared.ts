import { FliqError, isFinalState, type Payout, type Quote } from "../../../sdk/src/index.js";
import { envelope, money, type Envelope } from "./envelope.js";

const TOP_ROUTES = 3;
const REFUSED_CODES: ReadonlySet<string> = new Set(["velocity_limit", "agent_limit"]);

export function quoteEnvelope(result: Quote): Envelope {
  const routes = result.routes
    .filter((route) => route.rate !== null && route.status !== "paused")
    .slice(0, TOP_ROUTES)
    .map((route) => ({
      provider: route.provider,
      chosen: route.routed ?? route.provider === result.provider,
      receive: route.receive ?? null,
      rate: route.rate,
      fee_minor_units: route.fee ?? null,
      eta_seconds: route.eta_seconds ?? null,
      on_time_percent: route.on_time_percent ?? null,
      status: route.status,
    }));
  const summary =
    `Best of ${result.best_of} providers: ${result.provider} pays ${money(result.receive, result.currency)} ` +
    `for ${result.amount} ${result.token.toUpperCase()}; quote ${result.quote_id} holds for ${result.expires_in} seconds.`;
  return envelope(
    "ok",
    summary,
    {
      quote_id: result.quote_id,
      token: result.token,
      amount: result.amount,
      currency: result.currency,
      receive: result.receive,
      rate: result.rate,
      fees_minor_units: result.fees,
      eta_seconds: result.eta_seconds ?? null,
      expires_in: result.expires_in,
      routes,
    },
    { provider_of_record: result.provider },
  );
}

export function expiredQuote(quoteId: string): Envelope {
  return envelope(
    "refused",
    `Quote ${quoteId} has expired. Ask for a new quote with cashout_quote and confirm it with the person.`,
    { quote_id: quoteId },
  );
}

export function statusEnvelope(payout: Payout, receiptLink: (payoutId: string) => string | null): Envelope {
  return envelope("ok", statusSentence(payout), payoutData(payout), {
    provider_of_record: payout.provider,
    receipt_link: receiptLink(payout.payout_id),
  });
}

function statusSentence(payout: Payout): string {
  const amount = money(payout.receive, payout.currency);
  const to = payout.account_name;
  switch (payout.state) {
    case "settled":
      return `${amount} reached ${to}'s account through ${payout.provider}${payout.seconds === null || payout.seconds === undefined ? "" : ` in ${payout.seconds} seconds`}.`;
    case "awaiting_deposit":
      return `Payout ${payout.payout_id} of ${amount} to ${to} is waiting for the deposit of ${payout.deposit.amount}.`;
    case "refunding":
      return `Payout ${payout.payout_id} could not be completed and the money is being refunded.`;
    case "refunded":
      return `Payout ${payout.payout_id} was refunded${payout.refund ? ` (${payout.refund.amount} to the ${payout.refund.to})` : ""}.`;
    case "expired":
      return `Payout ${payout.payout_id} expired because no deposit arrived in time. Nothing moved.`;
    case "failed":
    case "refused":
      return `Payout ${payout.payout_id} did not go through${payout.failure ? ` (stopped at ${payout.failure.stage})` : ""}.`;
    case "not_received":
      return `Payout ${payout.payout_id} settled but the credit has not reached ${to}; support is following it up.`;
    default:
      return `Payout ${payout.payout_id} of ${amount} to ${to} is in progress (${payout.state.replace(/_/g, " ")}).`;
  }
}

// The model gets the name and the last four digits only; the full account number stays out of the transcript.
export function payoutData(payout: Payout) {
  return {
    payout_id: payout.payout_id,
    state: payout.state,
    final: isFinalState(payout.state),
    amount: payout.amount,
    receive: payout.receive,
    currency: payout.currency,
    rate: payout.rate,
    fees_minor_units: payout.fees,
    provider: payout.provider,
    account: { name: payout.account_name, bank: payout.account.bank, last4: payout.account.number.slice(-4) },
    deposit: payout.deposit,
    timeline: payout.history,
    hashes: {
      provider_order: payout.provider_order ?? null,
      vault_receipt: payout.vault_receipt ?? null,
      bank_reference: payout.bank_reference ?? null,
      refund_tx: payout.refund?.tx ?? null,
    },
    seconds_to_bank: payout.seconds ?? null,
    failure: payout.failure ?? null,
    refund: payout.refund ?? null,
  };
}

export function apiFailure(error: FliqError): Envelope {
  return envelope(REFUSED_CODES.has(error.code) ? "refused" : "error", error.message, {
    code: error.code,
    http_status: error.status,
    trace_id: error.traceId,
    fresh_quote_id: error.quote?.quote_id ?? null,
  });
}
