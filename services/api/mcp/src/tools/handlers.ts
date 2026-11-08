import {
  FliqError,
  isFinalState,
  type FliqClient,
  type Payout,
  type PayoutCountry,
  type Quote,
  type QuoteRequest,
  type RelayResult,
} from "../../../sdk/src/index.js";
import type { VaultAgent } from "../agent/vault-agent.js";
import { TOOL_DEFINITIONS, type ToolName } from "./definitions.js";
import { envelope, money, type Envelope } from "./envelope.js";
import type { Recipient, Session } from "./session.js";
import { validate } from "./validate.js";

export interface ToolContext {
  client: FliqClient;
  session: Session;
  agent?: VaultAgent;
  receiptLink: (payoutId: string) => string | null;
}

interface QuoteArgs {
  amount: string;
  currency: QuoteRequest["currency"];
  token?: QuoteRequest["token"];
  source_chain?: string;
  payout_type?: QuoteRequest["payout_type"];
  mode?: QuoteRequest["mode"];
}

interface VerifyArgs extends Recipient {
  account_name?: string;
}

interface PayArgs {
  quote_id: string;
  recipient: Recipient;
  provider?: string;
  refund_address?: string;
  client_reference?: string;
}

const TOKEN_DECIMALS = 6;
const TOP_ROUTES = 3;
const COUNTRY_OF: Record<string, string> = { ngn: "ng", kes: "ke", ghs: "gh", idr: "id", php: "ph" };
const VAULT_REFUSALS = [
  "POLICY_PER_PAYOUT_CAP",
  "POLICY_DAILY_CAP",
  "POLICY_CORRIDOR",
  "ORDER_EXPIRED",
  "UNAUTHORIZED",
];

export function isToolName(name: string): name is ToolName {
  return TOOL_DEFINITIONS.some((tool) => tool.name === name);
}

export async function callTool(name: ToolName, args: unknown, context: ToolContext): Promise<Envelope> {
  const definition = TOOL_DEFINITIONS.find((tool) => tool.name === name);
  const problem = definition ? validate(definition.inputSchema, args ?? {}) : `${name} is not a tool.`;
  if (problem) return envelope("invalid_input", problem, null);
  try {
    switch (name) {
      case "cashout_quote":
        return await quote(args as QuoteArgs, context);
      case "cashout_verify_account":
        return await verify(args as VerifyArgs, context);
      case "cashout_pay":
        return await pay(args as PayArgs, context);
      case "cashout_status":
        return await status((args as { payout_id: string }).payout_id, context);
    }
  } catch (error) {
    if (error instanceof FliqError) return apiFailure(error);
    return envelope("error", error instanceof Error ? error.message : "The tool failed.", null);
  }
}

async function quote(args: QuoteArgs, context: ToolContext): Promise<Envelope> {
  const result = await context.client.quote({ token: "usdc", ...args });
  context.session.rememberQuote(result);
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

async function verify(args: VerifyArgs, context: ToolContext): Promise<Envelope> {
  const recipient = { country: args.country, bank: args.bank, number: args.number };
  try {
    const account = await context.client.verifyAccount({
      bank: args.bank,
      number: args.number,
      country: args.country as PayoutCountry,
      account_name: args.account_name,
    });
    const nameVerified = account.name_verified !== false;
    context.session.rememberVerified(recipient, {
      accountName: account.account_name,
      nameVerified,
      suppliedName: nameVerified ? null : (args.account_name ?? null),
    });
    const summary = nameVerified
      ? `The ${account.institution} account belongs to ${account.account_name}. Confirm the name with the person before paying.`
      : `The ${account.institution} account was accepted with the name ${account.account_name} as given; the bank did not confirm it.`;
    return envelope("ok", summary, {
      account_name: account.account_name,
      institution: account.institution,
      bank: account.bank,
      account_last4: account.number.slice(-4),
      name_verified: nameVerified,
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
    if (error.code === "account_name_required") {
      return envelope(
        "name_required",
        "This bank cannot confirm names. Ask the person for the exact account name and call again with account_name.",
        null,
      );
    }
    throw error;
  }
}

async function pay(args: PayArgs, context: ToolContext): Promise<Envelope> {
  const verified = context.session.verifiedRecipient(args.recipient);
  if (!verified) {
    return envelope(
      "refused",
      "This account was not verified in this session. Call cashout_verify_account first and confirm the name with the person.",
      { quote_id: args.quote_id },
    );
  }
  const known = context.session.quote(args.quote_id);
  const mismatch = known ? routeMismatch(known, args) : null;
  if (known && mismatch)
    return envelope("refused", mismatch, { quote_id: args.quote_id }, { provider_of_record: known.provider });

  const payout = await context.client.createPayout(
    {
      quote_id: args.quote_id,
      account: { bank: args.recipient.bank, number: args.recipient.number },
      refund_address: args.refund_address,
      client_reference: args.client_reference,
      account_name: verified.suppliedName ?? undefined,
    },
    // One payout per quote: a model that repeats the call gets the same payout back, never a second one.
    { idempotencyKey: `fliq-mcp-${args.quote_id}` },
  );
  const token = known?.token.toUpperCase() ?? "the quoted token";
  const extra = {
    provider_of_record: payout.provider,
    refund_address: args.refund_address ?? null,
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
      `Payout ${payout.payout_id} of ${money(payout.receive, payout.currency)} to ${verified.accountName} is with ${payout.provider}; there is nothing to send.`,
      data,
      extra,
    );
  }
  if (!isVaultOrder(payout)) {
    return envelope(
      "awaiting_deposit",
      `Send ${payout.deposit.amount} ${token} on ${payout.deposit.chain} to ${payout.deposit.address}; then ${money(payout.receive, payout.currency)} goes to ${verified.accountName} through ${payout.provider}.`,
      data,
      extra,
    );
  }
  if (!context.agent) {
    return envelope(
      "awaiting_approval",
      `Payout ${payout.payout_id} of ${money(payout.receive, payout.currency)} to ${verified.accountName} is reserved in the vault; the person approves it in the fliq app. Nothing has moved yet.`,
      data,
      extra,
    );
  }
  return payFromVault(
    payout,
    context.agent,
    context,
    { ...extra, refund_address: extra.refund_address ?? "vault" },
    verified.accountName,
  );
}

function routeMismatch(quote: Quote, args: PayArgs): string | null {
  if (args.provider && args.provider !== quote.provider) {
    return `Quote ${quote.quote_id} pays through ${quote.provider}, not ${args.provider}. A payout always uses the quote's best route, so ask for a new quote.`;
  }
  if (COUNTRY_OF[quote.currency] !== args.recipient.country) {
    return `Quote ${quote.quote_id} pays out in ${quote.currency.toUpperCase()}, which does not match an account in ${args.recipient.country.toUpperCase()}.`;
  }
  return null;
}

async function payFromVault(
  payout: Payout,
  agent: VaultAgent,
  context: ToolContext,
  extra: { provider_of_record: string; refund_address: string; receipt_link: string | null },
  accountName: string,
): Promise<Envelope> {
  const { signedDelegate } = await agent.signPayout({
    orderId: payout.payout_id,
    amountUnits: toUnits(payout.deposit.amount),
    depositAddress: payout.deposit.address,
  });
  let relayed: RelayResult;
  try {
    relayed = await context.client.relay(signedDelegate);
  } catch (error) {
    if (!(error instanceof FliqError) || error.status !== 403) throw error;
    return envelope(
      "blocked",
      `Payout ${payout.payout_id} is reserved in the vault, but the fliq API does not yet accept a payout signed by an agent key; the person can approve it in the fliq app. Nothing has moved.`,
      { ...payoutData(payout), api_error: { code: error.code, message: error.message } },
      extra,
    );
  }
  const data = { ...payoutData(payout), relay: relayed };
  const amount = money(payout.receive, payout.currency);
  if (relayed.status === "succeeded") {
    return envelope(
      "paid",
      `Paid ${amount} to ${accountName} from the vault through ${payout.provider}. Track it with cashout_status.`,
      data,
      extra,
    );
  }
  if (relayed.status === "pending") {
    return envelope(
      "pending",
      `The vault payout of ${amount} is submitted and not final yet; check cashout_status shortly.`,
      data,
      extra,
    );
  }
  const refusal = VAULT_REFUSALS.find((code) => relayed.failures?.some((failure) => failure.includes(code)));
  return envelope(
    "refused",
    refusal
      ? `The vault refused the payout of ${amount} (${refusal}): it is outside the limits the person set for this agent. Nothing moved.`
      : `The vault payout of ${amount} failed on chain. Nothing moved.`,
    data,
    extra,
  );
}

async function status(payoutId: string, context: ToolContext): Promise<Envelope> {
  let payout: Payout;
  try {
    payout = await context.client.getPayout(payoutId);
  } catch (error) {
    if (error instanceof FliqError && error.status === 404) {
      return envelope("not_found", `There is no payout ${payoutId} for this API key.`, null);
    }
    throw error;
  }
  return envelope("ok", statusSentence(payout), payoutData(payout), {
    provider_of_record: payout.provider,
    receipt_link: context.receiptLink(payout.payout_id),
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
function payoutData(payout: Payout) {
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

// A vault order is paid by a payout call on the vault, not by a transfer from outside.
function isVaultOrder(payout: Payout): boolean {
  return (
    payout.vault_receipt !== null && payout.vault_receipt !== undefined && payout.deposit.chain === "near"
  );
}

export function toUnits(amount: string): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount);
  const fraction = match?.[2] ?? "";
  if (!match || fraction.length > TOKEN_DECIMALS)
    throw new Error("The deposit amount is not a token amount.");
  return BigInt(`${match[1]}${fraction.padEnd(TOKEN_DECIMALS, "0")}`);
}

function apiFailure(error: FliqError): Envelope {
  const status = error.code === "vault_cap_exceeded" || error.code === "velocity_limit" ? "refused" : "error";
  const fresh = error.quote;
  return envelope(status, error.message, {
    code: error.code,
    http_status: error.status,
    trace_id: error.traceId,
    refusal: error.refusal,
    fresh_quote_id: fresh?.quote_id ?? null,
  });
}
