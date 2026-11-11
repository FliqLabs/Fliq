import {
  FliqError,
  type FliqClient,
  type Payout,
  type PayoutCountry,
  type QuoteRequest,
} from "../../../sdk/src/index.js";
import type { SourceChain } from "../config.js";
import { envelope, money, type Envelope } from "./envelope.js";
import type { KnownQuote, Recipient, Session } from "./session.js";
import { expiredQuote, payoutData, quoteEnvelope, statusEnvelope } from "./shared.js";

export interface DeveloperContext {
  mode: "developer";
  client: FliqClient;
  session: Session;
  sourceChain: SourceChain;
  refundAddress: string | undefined;
  receiptLink: (payoutId: string) => string | null;
}

export interface QuoteArgs {
  amount: string;
  currency: QuoteRequest["currency"];
  token?: QuoteRequest["token"];
  source_chain?: SourceChain;
  payout_type?: QuoteRequest["payout_type"];
  mode?: QuoteRequest["mode"];
}

export interface VerifyArgs extends Recipient {
  account_name?: string;
}

export interface PayArgs {
  quote_id: string;
  recipient: Recipient;
  provider?: string;
  refund_address?: string;
  client_reference?: string;
}

const COUNTRY_OF: Record<string, string> = { ngn: "ng", kes: "ke", ghs: "gh", idr: "id", php: "ph" };
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
// The same shapes the API checks a refund address against, so a wrong one is caught before a payout is attempted.
const ADDRESS_SHAPES: Record<string, RegExp> = {
  base: EVM_ADDRESS,
  polygon: EVM_ADDRESS,
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
};

export async function quote(args: QuoteArgs, context: DeveloperContext): Promise<Envelope> {
  const sourceChain = args.source_chain ?? context.sourceChain;
  const result = await context.client.quote({ token: "usdc", ...args, source_chain: sourceChain });
  context.session.rememberQuote(result, sourceChain);
  return quoteEnvelope(result);
}

export async function verify(args: VerifyArgs, context: DeveloperContext): Promise<Envelope> {
  const recipient = { country: args.country, bank: args.bank, number: args.number };
  try {
    const account = await context.client.verifyAccount({
      bank: args.bank,
      number: args.number,
      country: args.country as PayoutCountry,
      account_name: args.account_name,
    });
    context.session.rememberVerified(recipient, account.account_name);
    const summary =
      account.name_verified === false
        ? `The ${account.institution} account was accepted with the name ${account.account_name} as given; the bank did not confirm it.`
        : `The ${account.institution} account belongs to ${account.account_name}. Confirm the name with the person before paying.`;
    return envelope("ok", summary, {
      account_name: account.account_name,
      institution: account.institution,
      bank: account.bank,
      account_last4: account.number.slice(-4),
      name_verified: account.name_verified !== false,
    });
  } catch (error) {
    if (!(error instanceof FliqError)) throw error;
    if (error.status === 404 || error.code === "account_not_found") {
      return envelope(
        "not_found",
        "The bank could not find that account. Check the number and the bank.",
        null,
      );
    }
    if (error.code === "account_name_required") return nameRequired();
    throw error;
  }
}

export async function pay(args: PayArgs, context: DeveloperContext): Promise<Envelope> {
  const accountName = context.session.verifiedName(args.recipient);
  if (!accountName) {
    return envelope(
      "refused",
      "This account was not verified in this session. Call cashout_verify_account first and confirm the name with the person.",
      { quote_id: args.quote_id },
    );
  }
  const known = context.session.quote(args.quote_id);
  if (known) {
    if (context.session.isExpired(known)) return expiredQuote(args.quote_id);
    const mismatch = routeMismatch(known, args);
    if (mismatch)
      return envelope(
        "refused",
        mismatch,
        { quote_id: args.quote_id },
        { provider_of_record: known.quote.provider },
      );
  }
  const refund = refundAddress(args, known, context);
  if ("envelope" in refund) return refund.envelope;

  let payout: Payout;
  try {
    payout = await context.client.createPayout(
      {
        quote_id: args.quote_id,
        account: { bank: args.recipient.bank, number: args.recipient.number },
        refund_address: refund.address,
        client_reference: args.client_reference,
        account_name: accountName,
      },
      // One payout per quote: a model that repeats the call gets the same payout back, never a second one.
      { idempotencyKey: `fliq-mcp-${args.quote_id}` },
    );
  } catch (error) {
    if (error instanceof FliqError && error.code === "account_name_required") return nameRequired();
    throw error;
  }
  return payoutEnvelope(payout, accountName, known, refund.address, context);
}

// A refund address must be on the chain the quote is funded from. A near quote can fall back to the key owner's
// fliq name on the API side, and a quote from another session has an unknown chain, so both go to the API as they are.
function refundAddress(
  args: PayArgs,
  known: KnownQuote | null,
  context: DeveloperContext,
): { address: string | undefined } | { envelope: Envelope } {
  const chain = known?.sourceChain;
  const shape = chain ? ADDRESS_SHAPES[chain] : undefined;
  if (args.refund_address) {
    if (shape && !shape.test(args.refund_address)) {
      return {
        envelope: envelope("invalid_input", `refund_address must be an address on ${chain}.`, {
          quote_id: args.quote_id,
        }),
      };
    }
    return { address: args.refund_address };
  }
  const fallback = context.refundAddress;
  if (!shape) return { address: fallback };
  if (fallback && shape.test(fallback)) return { address: fallback };
  return {
    envelope: envelope(
      "needs_refund_address",
      `Quote ${args.quote_id} is funded on ${chain}. Ask the person for their own ${chain} address, where the money goes back if the payout fails, then call cashout_pay again with refund_address.`,
      { quote_id: args.quote_id, source_chain: chain },
    ),
  };
}

function payoutEnvelope(
  payout: Payout,
  accountName: string,
  known: KnownQuote | null,
  refundAddress: string | undefined,
  context: DeveloperContext,
): Envelope {
  const token = known?.quote.token.toUpperCase() ?? "the quoted token";
  const extra = {
    provider_of_record: payout.provider,
    refund_address: refundAddress ?? null,
    receipt_link: context.receiptLink(payout.payout_id),
  };
  const data = payoutData(payout);
  if (!payout.deposit.address) {
    return envelope(
      "pending",
      `Payout ${payout.payout_id} is created and ${payout.provider} has not confirmed it yet; check cashout_status shortly.`,
      data,
      extra,
    );
  }
  // The API's marker for a provider fliq keeps funded in advance: there is no deposit to make.
  if (payout.deposit.chain === "internal") {
    return envelope(
      "pending",
      `Payout ${payout.payout_id} of ${money(payout.receive, payout.currency)} to ${accountName} is with ${payout.provider}; there is nothing to send.`,
      data,
      extra,
    );
  }
  // Only the vault owner's own key or one of their agents can release a vault order; an API key never can.
  if (isVaultOrder(payout)) {
    return envelope(
      "blocked",
      `Payout ${payout.payout_id} is an order on a fliq vault on NEAR, which an API key cannot pay. Vault payouts need this server in agent mode (FLIQ_AGENT_ID). Nothing has moved, and the order lapses on its own.`,
      data,
      extra,
    );
  }
  return envelope(
    "awaiting_deposit",
    `Send ${payout.deposit.amount} ${token} on ${payout.deposit.chain} to ${payout.deposit.address}; then ${money(payout.receive, payout.currency)} goes to ${accountName} through ${payout.provider}.`,
    data,
    extra,
  );
}

function routeMismatch(known: KnownQuote, args: PayArgs): string | null {
  const { quote } = known;
  if (args.provider && args.provider !== quote.provider) {
    return `Quote ${quote.quote_id} pays through ${quote.provider}, not ${args.provider}. A payout always uses the quote's best route, so ask for a new quote.`;
  }
  if (COUNTRY_OF[quote.currency] !== args.recipient.country) {
    return `Quote ${quote.quote_id} pays out in ${quote.currency.toUpperCase()}, which does not match an account in ${args.recipient.country.toUpperCase()}.`;
  }
  return null;
}

function isVaultOrder(payout: Payout): boolean {
  return (
    payout.vault_receipt !== null && payout.vault_receipt !== undefined && payout.deposit.chain === "near"
  );
}

function nameRequired(): Envelope {
  return envelope(
    "name_required",
    "This bank cannot confirm names. Ask the person for the exact account name and call cashout_verify_account again with account_name before paying.",
    null,
  );
}

export async function status(payoutId: string, context: DeveloperContext): Promise<Envelope> {
  try {
    return statusEnvelope(await context.client.getPayout(payoutId), context.receiptLink);
  } catch (error) {
    if (error instanceof FliqError && error.status === 404) {
      return envelope("not_found", `There is no payout ${payoutId} for this API key.`, null);
    }
    throw error;
  }
}
