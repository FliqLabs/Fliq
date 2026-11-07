import type { Agent } from "@prisma/client";
import { MAX_AGENT_STORAGE_DEPOSIT } from "../../../packages/chains/near/policy.js";
import type { AgentPolicy, VaultClient } from "../../../packages/chains/vault/index.js";
import type { NearProvisioner } from "./accounts.js";
import type { Config } from "./config.js";
import type { Db, Unit } from "./db.js";
import { ApiError, conflict, invalidRequest, notFound } from "./errors.js";
import type { Rate } from "./rates.js";

const SET_AGENT_GAS = "30000000000000";
const REMOVE_AGENT_GAS = "30000000000000";
const POLICY_LIFETIME_MS = 365 * 24 * 60 * 60_000;
const USDC_SCALE = 1_000_000;
const LABEL_MAX = 32;
const ED25519_KEY = /^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/;
// What an agent may pay out to, by the currencies the user ticked. The vault matches corridors exactly.
const CORRIDORS: Record<string, string[]> = {
  NGN: ["NG-NGN-bank", "NG-NGN-mobile_money"],
  KES: ["KE-KES-mobile_money", "KE-KES-bank"],
};

type Money = { amount: string; currency: string };

export interface AgentLimits {
  daily_cap: Money;
  per_payout_cap: Money;
  currencies: string[];
  saved_accounts_only: boolean;
}

export interface AgentInput extends AgentLimits {
  name: string;
  public_key: string;
}

export interface AgentDeps {
  config: Config;
  vault: VaultClient;
  provisioner: NearProvisioner;
  rate: (token: string, currency: string) => Promise<Rate>;
  now?: () => Date;
}

type Caps = { currency: string; dailyMinor: bigint; perPayoutMinor: bigint };

function capsOf(limits: AgentLimits): Caps {
  const { daily_cap: daily, per_payout_cap: perPayout } = limits;
  if (daily.currency !== perPayout.currency) throw invalidRequest("daily_cap and per_payout_cap must be in the same currency.");
  if (!(daily.currency in CORRIDORS)) throw invalidRequest("Caps must be in NGN or KES.");
  const whole = (money: Money, field: string) => {
    if (!/^[1-9]\d{0,12}$/.test(money.amount)) throw invalidRequest(`${field} must be a whole positive amount.`);
    return BigInt(money.amount) * 100n;
  };
  const dailyMinor = whole(daily, "daily_cap");
  const perPayoutMinor = whole(perPayout, "per_payout_cap");
  if (perPayoutMinor > dailyMinor) throw invalidRequest("per_payout_cap cannot be more than daily_cap.");
  if (limits.currencies.length === 0 || limits.currencies.some((currency) => !(currency in CORRIDORS))) {
    throw invalidRequest("currencies must list NGN, KES or both.");
  }
  return { currency: daily.currency, dailyMinor, perPayoutMinor };
}

// The vault caps are USDC. Converting down at the live rate keeps the chain's cap at or under what the user chose.
async function usdcCaps(deps: AgentDeps, caps: Caps) {
  const rate = await deps.rate("usdc", caps.currency.toLowerCase()).catch(() => {
    throw new ApiError(503, "route_unavailable", `No ${caps.currency} rate is available to set the caps right now. Try again in a moment.`);
  });
  const toUnits = (minor: bigint) => BigInt(Math.floor((Number(minor) / 100 / rate.rate) * USDC_SCALE));
  const daily = toUnits(caps.dailyMinor);
  const perPayout = toUnits(caps.perPayoutMinor);
  if (perPayout <= 0n) throw invalidRequest("per_payout_cap is too small to set on chain.");
  return { daily, perPayout };
}

function setAgentStep(deps: AgentDeps, agent: Pick<Agent, "id" | "publicKey" | "currencies" | "expiresAt">, units: { daily: bigint; perPayout: bigint }) {
  return {
    kind: "function_call" as const,
    receiver_id: deps.config.vaultAccount,
    method_name: "set_agent",
    args: {
      public_key: agent.publicKey,
      agent_id: agent.id,
      per_payout_cap: units.perPayout.toString(),
      daily_cap: units.daily.toString(),
      corridors: agent.currencies.flatMap((currency) => CORRIDORS[currency] ?? []),
      cooldown_ns: "0",
      expiry_ns: (BigInt(agent.expiresAt.getTime()) * 1_000_000n).toString(),
    },
    gas: SET_AGENT_GAS,
    deposit: MAX_AGENT_STORAGE_DEPOSIT.toString(),
    public_key: null,
  };
}

function agentView(agent: Agent, state: Agent["state"], spentMinor: bigint) {
  const money = (minor: bigint) => ({ amount: String(minor / 100n), currency: agent.capCurrency });
  return {
    agent_id: agent.id,
    name: agent.name,
    public_key: agent.publicKey,
    state,
    daily_cap: money(agent.dailyCapMinor),
    per_payout_cap: money(agent.perPayoutCapMinor),
    currencies: agent.currencies,
    saved_accounts_only: agent.savedAccountsOnly,
    spent_today: money(spentMinor),
    connected_at: agent.createdAt.toISOString(),
    expires_at: agent.expiresAt.toISOString(),
  };
}

// The agent account sits under fliq's root so the relayer can create it: <agent>-<user>.<root>.
export function agentAccountFor(name: string, owner: string, config: Config): string {
  const agent = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "agent";
  const user = owner.replace(`.${config.nearRootAccount}`, "");
  const label = `${agent}-${user}`.replace(/-+/g, "-").slice(0, LABEL_MAX).replace(/-+$/, "");
  return `${label}.${config.nearRootAccount}`;
}

async function ownerOf(tx: Db, userId: string): Promise<string> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { nearAccount: true } });
  if (!user?.nearAccount) throw notFound("Claim a fliq name before connecting an agent.");
  return user.nearAccount;
}

export async function connectAgent(unit: Unit, deps: AgentDeps, userId: string, input: AgentInput) {
  const name = input.name.trim();
  if (!name) throw invalidRequest("name is required.");
  if (!ED25519_KEY.test(input.public_key)) throw invalidRequest("public_key must be ed25519:<base58>.");
  const caps = capsOf(input);
  const owner = await unit((tx) => ownerOf(tx, userId));
  const agentId = agentAccountFor(name, owner, deps.config);
  const existing = await unit((tx) => tx.agent.findUnique({ where: { id: agentId } }));
  const taken = existing && (existing.userId !== userId || (existing.state !== "revoked" && existing.publicKey !== input.public_key));
  if (taken) throw conflict(`An agent called ${name} is already connected. Pick another name or revoke it first.`);
  const units = await usdcCaps(deps, caps);
  await deps.provisioner.createAccount(agentId, input.public_key);
  const now = deps.now?.() ?? new Date();
  const agent = await unit((tx) =>
    tx.agent.upsert({
      where: { id: agentId },
      create: {
        id: agentId,
        userId,
        owner,
        name,
        publicKey: input.public_key,
        capCurrency: caps.currency,
        dailyCapMinor: caps.dailyMinor,
        perPayoutCapMinor: caps.perPayoutMinor,
        currencies: input.currencies,
        savedAccountsOnly: input.saved_accounts_only,
        expiresAt: new Date(now.getTime() + POLICY_LIFETIME_MS),
      },
      update: {
        state: "pending",
        revokedAt: null,
        capCurrency: caps.currency,
        dailyCapMinor: caps.dailyMinor,
        perPayoutCapMinor: caps.perPayoutMinor,
        currencies: input.currencies,
        savedAccountsOnly: input.saved_accounts_only,
        expiresAt: new Date(now.getTime() + POLICY_LIFETIME_MS),
      },
    }),
  );
  return { agent: agentView(agent, "pending", 0n), steps: [setAgentStep(deps, agent, units)] };
}

async function ownedAgent(tx: Db, userId: string, agentId: string): Promise<Agent> {
  const agent = await tx.agent.findFirst({ where: { id: agentId, userId } });
  if (!agent || agent.state === "revoked") throw notFound("No such agent.");
  return agent;
}

export async function updateAgentLimits(unit: Unit, deps: AgentDeps, userId: string, agentId: string, limits: AgentLimits) {
  const caps = capsOf(limits);
  await unit((tx) => ownedAgent(tx, userId, agentId));
  const units = await usdcCaps(deps, caps);
  const agent = await unit((tx) =>
    tx.agent.update({
      where: { id: agentId },
      data: { capCurrency: caps.currency, dailyCapMinor: caps.dailyMinor, perPayoutCapMinor: caps.perPayoutMinor, currencies: limits.currencies, savedAccountsOnly: limits.saved_accounts_only },
    }),
  );
  return { agent: agentView(agent, agent.state, 0n), steps: [setAgentStep(deps, agent, units)] };
}

export async function revokeAgent(unit: Unit, deps: AgentDeps, userId: string, agentId: string) {
  const agent = await unit((tx) => ownedAgent(tx, userId, agentId));
  return {
    agent: agentView(agent, agent.state, 0n),
    steps: [
      {
        kind: "function_call" as const,
        receiver_id: deps.config.vaultAccount,
        method_name: "remove_agent",
        args: { agent_id: agent.id },
        gas: REMOVE_AGENT_GAS,
        deposit: "1",
        public_key: null,
      },
    ],
  };
}

// The vault is the authority on whether an agent may pay. A policy that is gone means the user revoked it.
function stateFrom(agent: Agent, policy: AgentPolicy | null): Agent["state"] {
  if (policy && !policy.revoked) return "active";
  return agent.state === "pending" ? "pending" : "revoked";
}

export async function listAgents(unit: Unit, deps: AgentDeps, userId: string) {
  const agents = await unit((tx) => tx.agent.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }));
  const views = await Promise.all(
    agents.map(async (agent) => {
      if (agent.state === "revoked") return agentView(agent, "revoked", 0n);
      const policy = await deps.vault.getAgent(agent.owner, agent.id).catch(() => undefined);
      if (policy === undefined) return agentView(agent, agent.state, 0n);
      const state = stateFrom(agent, policy);
      if (state !== agent.state) {
        await unit((tx) => tx.agent.update({ where: { id: agent.id }, data: { state, revokedAt: state === "revoked" ? new Date() : null } }));
      }
      const spentMinor = policy && policy.dailyCap > 0n ? (policy.spentToday * agent.dailyCapMinor) / policy.dailyCap : 0n;
      return agentView(agent, state, spentMinor);
    }),
  );
  return { agents: views };
}
