import type { Agent } from "@prisma/client";
import { decrypt } from "../../../packages/db/src/crypto.js";
import { newId } from "../../../packages/db/src/ids.js";
import type { AgentPolicy, VaultClient } from "../../../packages/chains/vault/index.js";
import type { Config } from "./config.js";
import { formatTokenAmount } from "./dashboard.js";
import type { Unit } from "./db.js";
import { parseUnits } from "./deposits.js";
import { ApiError, invalidRequest, notFound } from "./errors.js";
import type { Reply } from "./idempotency.js";
import { createPayout, payoutView, type PayoutDeps } from "./payouts.js";
import { developerIdFor, quoteAndSave, type QuoteDeps, type QuoteInput } from "./quotes.js";
import { listRecipients } from "./recipients.js";

// The vault forwards 30 Tgas to the token transfer and 20 Tgas to its callback, on top of its own work.
const PAYOUT_GAS = "80000000000000";

export interface AgentPayoutDeps {
  config: Config;
  vault: VaultClient;
  quotes: QuoteDeps;
  payouts: PayoutDeps;
}

export interface AgentPayoutInput {
  quote_id: string;
  recipient_id?: string;
  account?: { bank: string; number: string };
}

type Refusal = "POLICY_CORRIDOR" | "POLICY_PER_PAYOUT_CAP" | "POLICY_DAILY_CAP" | "SAVED_ACCOUNTS_ONLY";

const REFUSAL_MESSAGES: Record<Refusal, string> = {
  POLICY_CORRIDOR: "This agent may not pay in that currency.",
  POLICY_PER_PAYOUT_CAP: "Over this agent's per-payout cap.",
  POLICY_DAILY_CAP: "Over this agent's daily cap.",
  SAVED_ACCOUNTS_ONLY: "This agent may only pay the owner's saved accounts.",
};

async function policyOf(vault: VaultClient, agent: Agent): Promise<AgentPolicy | null | undefined> {
  return vault.getAgent(agent.owner, agent.id).catch(() => undefined);
}

export async function agentSelf(unit: Unit, vault: VaultClient, agentId: string) {
  const agent = await unit((tx) => tx.agent.findUniqueOrThrow({ where: { id: agentId } }));
  const policy = await policyOf(vault, agent);
  const money = (minor: bigint) => ({ amount: String(minor / 100n), currency: agent.capCurrency });
  const usd = (units: bigint | undefined) => (units === undefined ? null : formatTokenAmount(units));
  const live = policy && !policy.revoked ? policy : undefined;
  return {
    agent_id: agent.id,
    owner: agent.owner,
    name: agent.name,
    state: live ? "active" : agent.state,
    daily_cap: money(agent.dailyCapMinor),
    per_payout_cap: money(agent.perPayoutCapMinor),
    currencies: agent.currencies,
    saved_accounts_only: agent.savedAccountsOnly,
    spent_today_usd: usd(live?.spentToday),
    remaining_today_usd: usd(live ? (live.dailyCap > live.spentToday ? live.dailyCap - live.spentToday : 0n) : undefined),
    per_payout_usd: usd(live?.perPayoutCap),
  };
}

export async function agentRecipients(unit: Unit, config: Config, ownerId: string) {
  return unit((tx) => listRecipients(tx, config, ownerId));
}

// An agent pays from the owner's vault, so its quote is always from NEAR in USDC.
export async function quoteForAgent(unit: Unit, quotes: QuoteDeps, ownerId: string, input: { currency: QuoteInput["currency"]; amount: string; mode?: "send" | "receive" }) {
  return quoteAndSave(unit, quotes, ownerId, { token: "usdc", currency: input.currency, amount: input.amount, source_chain: "near", mode: input.mode ?? "send" });
}

async function refuse(unit: Unit, agent: Agent, reason: Refusal, receiveMinor: bigint | null, currency: string | null): Promise<never> {
  await unit((tx) =>
    tx.agentRefusal.create({ data: { id: newId("ref"), userId: agent.userId, agentId: agent.id, reason, amountMinor: receiveMinor, currency } }),
  );
  throw new ApiError(422, "agent_limit", REFUSAL_MESSAGES[reason]);
}

// Checked before any provider order or vault order exists, so a refused payout leaves nothing behind but the record.
// The vault checks the caps again when the agent's signed payout runs.
export async function createAgentPayout(unit: Unit, deps: AgentPayoutDeps, agentId: string, key: string | undefined, input: AgentPayoutInput): Promise<Reply> {
  if (!key) throw new ApiError(400, "idempotency_key_required", "Idempotency-Key header is required.");
  if (!input.recipient_id === !input.account) throw invalidRequest("Send either recipient_id or account.");
  const agent = await unit((tx) => tx.agent.findUniqueOrThrow({ where: { id: agentId } }));
  const prepared = await unit(async (tx) => {
    const quote = await tx.quote.findFirst({ where: { id: input.quote_id, developerId: await developerIdFor(tx, agent.userId) }, include: { routes: { where: { rank: 1 } } } });
    const route = quote?.routes[0];
    if (!quote || !route) throw notFound("No such quote.");
    const recipient = input.recipient_id
      ? await tx.recipient.findFirst({ where: { id: input.recipient_id, userId: agent.userId, savedAt: { not: null }, deletedAt: null } })
      : null;
    if (input.recipient_id && !recipient) throw notFound("No such saved account.");
    return { quote, route, recipient };
  });
  const currency = prepared.quote.currency.toUpperCase();
  const receive = prepared.route.amountOutMinor;

  if (!agent.currencies.includes(currency)) return refuse(unit, agent, "POLICY_CORRIDOR", receive, currency);
  if (input.account && agent.savedAccountsOnly) return refuse(unit, agent, "SAVED_ACCOUNTS_ONLY", receive, currency);
  const policy = await policyOf(deps.vault, agent);
  if (policy === null || policy?.revoked) throw new ApiError(403, "forbidden", "The vault holds no active policy for this agent. Ask the owner to connect it again.");
  if (policy) {
    if (prepared.route.amountIn > policy.perPayoutCap) return refuse(unit, agent, "POLICY_PER_PAYOUT_CAP", receive, currency);
    if (policy.spentToday + prepared.route.amountIn > policy.dailyCap) return refuse(unit, agent, "POLICY_DAILY_CAP", receive, currency);
  }

  const account = prepared.recipient
    ? { bank: prepared.recipient.institutionCode, number: decrypt(prepared.recipient.accountCipher, deps.config.dataKey) }
    : (input.account as { bank: string; number: string });
  const reply = await createPayout(unit, deps.payouts, agent.userId, `agent:${agent.id}:${key}`, { quote_id: input.quote_id, account }, { agentId: agent.id });
  if (reply.status !== 201) return reply;
  const payout = reply.body as { payout_id: string; deposit: { chain: string; address: string; amount: string } };
  if (payout.deposit.chain !== "near") throw new ApiError(422, "route_unavailable", "Agents pay from the vault over NEAR, and this quote is not one.");
  return {
    status: 201,
    body: {
      payout,
      sign: {
        kind: "function_call",
        receiver_id: deps.config.vaultAccount,
        method_name: "payout",
        args: { order_id: payout.payout_id, amount: (parseUnits(payout.deposit.amount, 6) as bigint).toString(), deposit_address: payout.deposit.address },
        gas: PAYOUT_GAS,
        deposit: "0",
        public_key: null,
      },
    },
  };
}

export async function getAgentPayout(unit: Unit, config: Config, agentId: string, payoutId: string) {
  return unit(async (tx) => {
    const found = await tx.payout.findFirst({ where: { id: payoutId, agentId }, select: { id: true } });
    if (!found) throw notFound("No such payout.");
    return payoutView(tx, config, payoutId);
  });
}
