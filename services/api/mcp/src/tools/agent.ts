import {
  FliqError,
  type AgentPayout,
  type AgentQuoteRequest,
  type RelayResult,
} from "../../../sdk/src/index.js";
import type { AgentClient } from "../agent/agent-client.js";
import { envelope, money, type Envelope } from "./envelope.js";
import type { Session } from "./session.js";
import { expiredQuote, payoutData, quoteEnvelope, statusEnvelope } from "./shared.js";

export interface AgentContext {
  mode: "agent";
  agent: AgentClient;
  session: Session;
  receiptLink: (payoutId: string) => string | null;
}

export interface AgentPayArgs {
  quote_id: string;
  recipient_id: string;
}

const VAULT_REFUSALS = [
  "POLICY_PER_PAYOUT_CAP",
  "POLICY_DAILY_CAP",
  "POLICY_CORRIDOR",
  "ORDER_EXPIRED",
  "UNAUTHORIZED",
];

export async function limits(context: AgentContext): Promise<Envelope> {
  const self = await context.agent.self();
  const caps = `up to ${self.per_payout_cap.amount} ${self.per_payout_cap.currency} per payout and ${self.daily_cap.amount} ${self.daily_cap.currency} a day in ${self.currencies.join(" and ")}`;
  const left = self.remaining_today_usd === null ? "" : `; ${self.remaining_today_usd} USDC is left today`;
  const accounts = self.saved_accounts_only ? " Only the owner's saved accounts can be paid." : "";
  const summary =
    self.state === "active"
      ? `${self.name} may pay ${caps}${left}.${accounts}`
      : `${self.name} is ${self.state}: the owner has to finish connecting it in the fliq app before it can pay. Its limits will be ${caps}.`;
  return envelope("ok", summary, self);
}

export async function recipients(context: AgentContext): Promise<Envelope> {
  const { items } = await context.agent.recipients();
  const accounts = items.map((item) => ({
    recipient_id: item.recipient_id,
    account_name: item.account_name,
    institution: item.bank.name,
    account_last4: item.account_last4,
    default: item.default ?? false,
  }));
  const summary =
    accounts.length === 0
      ? "The owner has no saved accounts yet; they can add one in the fliq app."
      : `${accounts.length} saved account${accounts.length === 1 ? "" : "s"}: ${accounts
          .map(
            (account) => `${account.account_name} (${account.institution} ending ${account.account_last4})`,
          )
          .join(", ")}.`;
  return envelope("ok", summary, { recipients: accounts });
}

export async function quote(args: AgentQuoteRequest, context: AgentContext): Promise<Envelope> {
  const result = await context.agent.quote(args);
  context.session.rememberQuote(result, "near");
  return quoteEnvelope(result);
}

export async function pay(args: AgentPayArgs, context: AgentContext): Promise<Envelope> {
  const known = context.session.quote(args.quote_id);
  if (known && context.session.isExpired(known)) return expiredQuote(args.quote_id);

  let created: AgentPayout;
  try {
    // One payout per quote: a model that repeats the call gets the same payout back, never a second one.
    created = await context.agent.createPayout(
      { quote_id: args.quote_id, recipient_id: args.recipient_id },
      `fliq-mcp-${args.quote_id}`,
    );
  } catch (error) {
    if (error instanceof FliqError && error.code === "agent_limit") {
      return envelope(
        "refused",
        `fliq refused the payout: ${error.message} Nothing moved. The owner can change the limits in the fliq app.`,
        { quote_id: args.quote_id, code: error.code },
      );
    }
    throw error;
  }

  const { payout, sign } = created;
  const amount = money(payout.receive, payout.currency);
  const extra = {
    provider_of_record: payout.provider,
    refund_address: "vault",
    receipt_link: context.receiptLink(payout.payout_id),
  };
  let relayed: RelayResult;
  try {
    relayed = await context.agent.relay(await context.agent.signStep(sign));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "the relay failed";
    return envelope(
      "error",
      `Payout ${payout.payout_id} is reserved in the vault, but the signed vault payout was not accepted (${reason}). Nothing has moved; call cashout_pay again to retry.`,
      payoutData(payout),
      extra,
    );
  }
  const data = { ...payoutData(payout), relay: relayed };
  if (relayed.status !== "failed") {
    const progress = relayed.status === "succeeded" ? "left the vault" : "is being sent from the vault";
    return envelope(
      "pending",
      `${amount} to ${payout.account_name} ${progress} through ${payout.provider}; the bank transfer follows. Track it with cashout_status.`,
      data,
      extra,
    );
  }
  const refusal = VAULT_REFUSALS.find((code) => relayed.failures?.some((failure) => failure.includes(code)));
  return envelope(
    "refused",
    refusal
      ? `The vault refused the payout of ${amount} (${refusal}): it is outside the limits the owner set for this agent. Nothing moved.`
      : `The vault payout of ${amount} failed on chain. Nothing moved.`,
    data,
    extra,
  );
}

export async function status(payoutId: string, context: AgentContext): Promise<Envelope> {
  try {
    return statusEnvelope(await context.agent.getPayout(payoutId), context.receiptLink);
  } catch (error) {
    if (error instanceof FliqError && error.status === 404) {
      return envelope("not_found", `This agent made no payout ${payoutId}.`, null);
    }
    throw error;
  }
}
