import type { DepositState, VaultDeposit } from "@prisma/client";
import { OneClickError, type OneClickClient, type OneClickExecution, type OneClickQuote, type OneClickToken } from "../../../packages/chains/oneclick/index.js";
import { newId } from "../../../packages/db/src/ids.js";
import { postEntry } from "../../../packages/ledger/post.js";
import { vaultCredited } from "../../../packages/ledger/postings.js";
import type { Db, Unit } from "./db.js";
import { ApiError, invalidRequest, notFound } from "./errors.js";
import { markRequestPaid } from "./requests.js";

export type DepositToken = "usdc" | "usdt" | "btc";
export type DepositChain = "base" | "solana" | "tron" | "arbitrum" | "ethereum" | "polygon" | "bitcoin" | "near";

interface Source {
  token: DepositToken;
  chain: DepositChain;
  group: "dollars" | "bitcoin" | "near";
  minimum: string;
  etaSeconds: number;
  watchMinutes: number;
}

// Display order of the receive screen. Tron's floor is high because its network fee is.
export const DEPOSIT_SOURCES: readonly Source[] = [
  { token: "usdc", chain: "base", group: "dollars", minimum: "1", etaSeconds: 35, watchMinutes: 10 },
  { token: "usdc", chain: "solana", group: "dollars", minimum: "1", etaSeconds: 35, watchMinutes: 10 },
  { token: "usdt", chain: "tron", group: "dollars", minimum: "100", etaSeconds: 60, watchMinutes: 10 },
  { token: "usdc", chain: "arbitrum", group: "dollars", minimum: "1", etaSeconds: 35, watchMinutes: 10 },
  { token: "usdc", chain: "ethereum", group: "dollars", minimum: "1", etaSeconds: 90, watchMinutes: 10 },
  { token: "usdc", chain: "polygon", group: "dollars", minimum: "1", etaSeconds: 35, watchMinutes: 10 },
  { token: "btc", chain: "bitcoin", group: "bitcoin", minimum: "0.0001", etaSeconds: 600, watchMinutes: 60 },
  { token: "usdc", chain: "near", group: "near", minimum: "0.01", etaSeconds: 2, watchMinutes: 0 },
];

const ONECLICK_BLOCKCHAIN: Record<DepositChain, string> = {
  base: "base",
  solana: "sol",
  tron: "tron",
  arbitrum: "arb",
  ethereum: "eth",
  polygon: "pol",
  bitcoin: "btc",
  near: "near",
};

const TOKENS_TTL_MS = 60_000;
const POLL_EVERY_MS = 3_000;
// A deposit that arrives after its address expired is still refunded by 1Click, so it is followed this long.
const LATE_WINDOW_MS = 24 * 60 * 60_000;
const USD_DECIMALS = 6;
const FINAL: ReadonlySet<DepositState> = new Set(["landed", "refunded", "failed"]);

export interface DepositDeps {
  client: OneClickClient | undefined;
  // The vault contract receives every top-up; the message names whose balance it credits.
  vaultAccount: string;
  usdcContract: string;
  slippageBps: number;
  now?: () => Date;
  // On chain, 1Click's ft_transfer_call has already credited the vault. A stand-in vault has to be told.
  onLanded?: (landing: { account: string; units: bigint; message: string }) => Promise<void> | void;
}

export interface DepositInput {
  token: DepositToken;
  chain: DepositChain;
  amount: string;
}

export const topUpMessage = (account: string) => JSON.stringify({ top_up: { account_id: account } });

export function parseUnits(value: string, decimals: number): bigint | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  return BigInt(match[1] as string) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

export function formatUnits(units: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const fraction = (units % scale).toString().padStart(decimals, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${units / scale}.${fraction}`;
}

// Fees are shown to the cent, rounded to the nearest one.
export function formatUsd(microUsd: bigint): string {
  const cents = (microUsd + 5_000n) / 10_000n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

function quotedFee(quote: OneClickQuote, source: OneClickToken): bigint {
  const usdIn = quote.amountInUsd === undefined ? null : parseUnits(quote.amountInUsd, USD_DECIMALS);
  const usdOut = quote.amountOutUsd === undefined ? null : parseUnits(quote.amountOutUsd, USD_DECIMALS);
  if (usdIn !== null && usdOut !== null) return usdIn > usdOut ? usdIn - usdOut : 0n;
  // Without 1Click's dollar figures only a dollar token can be priced: one unit is one micro dollar.
  if (source.symbol !== "BTC" && source.decimals === USD_DECIMALS && quote.amountIn > quote.amountOut) return quote.amountIn - quote.amountOut;
  return 0n;
}

const RANK: Record<DepositState, number> = { waiting: 0, expired: 0, seen: 1, underpaid: 1, bridging: 2, landed: 3, refunded: 3, failed: 3 };

const STATE_OF: Record<OneClickExecution["status"], DepositState> = {
  PENDING_DEPOSIT: "waiting",
  KNOWN_DEPOSIT_TX: "seen",
  INCOMPLETE_DEPOSIT: "underpaid",
  PROCESSING: "bridging",
  SUCCESS: "landed",
  REFUNDED: "refunded",
  FAILED: "failed",
};

type Tracked = Pick<
  VaultDeposit,
  "state" | "reservedUntil" | "receivedUnits" | "landedUnits" | "refundedUnits" | "refundReason" | "originTx" | "seenAt" | "bridgingAt" | "landedAt" | "intentsStatus"
>;

// What one 1Click answer, or the lack of one, does to a deposit. A step never goes back, and a final state is final.
export function nextDeposit(current: Tracked, execution: OneClickExecution | undefined, now: Date): Tracked {
  if (FINAL.has(current.state)) return current;
  if (!execution) return current.state === "waiting" && now > current.reservedUntil ? { ...current, state: "expired" } : current;

  let state = STATE_OF[execution.status];
  if (state === "waiting") state = now > current.reservedUntil ? "expired" : current.state === "expired" ? "waiting" : current.state;
  if (RANK[state] < RANK[current.state]) state = current.state;

  const at = execution.updatedAt < now ? execution.updatedAt : now;
  const reached = (rank: number) => RANK[state] >= rank && state !== "refunded" && state !== "failed";
  return {
    state,
    reservedUntil: current.reservedUntil,
    intentsStatus: execution.status,
    receivedUnits: execution.depositedAmount ?? current.receivedUnits,
    landedUnits: state === "landed" ? (execution.amountOut ?? current.landedUnits) : current.landedUnits,
    refundedUnits: state === "refunded" ? (execution.refundedAmount ?? current.refundedUnits) : current.refundedUnits,
    refundReason: state === "refunded" ? (execution.refundReason ?? current.refundReason) : current.refundReason,
    originTx: execution.originTxHashes[0] ?? current.originTx,
    seenAt: current.seenAt ?? (reached(1) || (state === "refunded" && execution.depositedAmount !== undefined) ? at : null),
    bridgingAt: current.bridgingAt ?? (reached(2) ? at : null),
    landedAt: current.landedAt ?? (state === "landed" ? at : null),
  };
}

export function depositView(row: VaultDeposit) {
  const usdc = (units: bigint | null) => (units === null ? null : formatUnits(units, USD_DECIMALS));
  const source = (units: bigint | null) => (units === null ? null : formatUnits(units, row.decimals));
  return {
    deposit_id: row.id,
    state: row.state,
    token: row.token,
    chain: row.chain,
    address: row.depositAddress,
    memo: row.depositMemo,
    amount: formatUnits(row.amountUnits, row.decimals),
    minimum: formatUnits(row.minimumUnits, row.decimals),
    fee: formatUsd(row.feeMicroUsd),
    lands: formatUnits(row.landsUnits, USD_DECIMALS),
    eta_seconds: row.etaSeconds,
    reserved_until: row.reservedUntil.toISOString(),
    received: source(row.receivedUnits),
    landed: usdc(row.landedUnits),
    refunded: source(row.refundedUnits),
    seen_at: row.seenAt?.toISOString() ?? null,
    bridging_at: row.bridgingAt?.toISOString() ?? null,
    landed_at: row.landedAt?.toISOString() ?? null,
    seconds: row.seenAt && row.landedAt ? Math.round((row.landedAt.getTime() - row.seenAt.getTime()) / 1000) : null,
    origin_tx: row.originTx,
    created_at: row.createdAt.toISOString(),
  };
}

const unavailable = (chain: string) => new ApiError(503, "route_unavailable", `Receiving from ${chain} is not available right now. Try again in a moment.`);

function intentsError(error: unknown, chain: string): ApiError {
  if (error instanceof OneClickError && error.kind === "rejected") return invalidRequest(`NEAR Intents will not take this amount from ${chain}.`);
  if (error instanceof OneClickError) return unavailable(chain);
  throw error;
}

async function vaultAccountOf(tx: Db, userId: string): Promise<string> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { nearAccount: true } });
  if (!user?.nearAccount) throw notFound("Claim a fliq name to get a vault.");
  return user.nearAccount;
}

export function createDeposits(deps: DepositDeps) {
  const now = deps.now ?? (() => new Date());
  let tokens: { at: number; list: OneClickToken[] } | null = null;

  async function tokenList(client: OneClickClient): Promise<OneClickToken[]> {
    if (!tokens || now().getTime() - tokens.at > TOKENS_TTL_MS) tokens = { at: now().getTime(), list: await client.tokens() };
    return tokens.list;
  }

  // The destination must be the USDC the vault accepts: any other token is handed back by ft_on_transfer and lost to the sender.
  async function route(token: DepositToken, chain: DepositChain) {
    const source = DEPOSIT_SOURCES.find((item) => item.token === token && item.chain === chain);
    if (!source) throw invalidRequest(`${token.toUpperCase()} on ${chain} is not a way to top up.`);
    if (!deps.client) throw unavailable(chain);
    const list = await tokenList(deps.client).catch((error) => {
      throw intentsError(error, chain);
    });
    const origin = list.find((item) => item.blockchain === ONECLICK_BLOCKCHAIN[chain] && item.symbol.toLowerCase() === token);
    const destination = list.find((item) => item.blockchain === "near" && item.symbol === "USDC");
    if (!origin || !destination) throw unavailable(chain);
    if (destination.contractAddress !== undefined && destination.contractAddress !== deps.usdcContract) throw unavailable(chain);
    return { source, origin, destination, client: deps.client };
  }

  function amountOf(input: { amount: string }, origin: OneClickToken, source: Source): bigint {
    const units = parseUnits(input.amount, origin.decimals);
    if (units === null || units <= 0n) throw invalidRequest("amount must be a positive decimal string.");
    const minimum = parseUnits(source.minimum, origin.decimals) as bigint;
    if (units < minimum) throw invalidRequest(`The minimum from ${source.chain} is ${formatUnits(minimum, origin.decimals)} ${source.token.toUpperCase()}.`);
    return units;
  }

  async function flexQuote(dry: boolean, account: string, picked: Awaited<ReturnType<typeof route>>, units: bigint, deadline: Date) {
    return picked.client
      .quote({
        dry,
        swapType: "FLEX_INPUT",
        slippageBps: deps.slippageBps,
        originAsset: picked.origin.assetId,
        destinationAsset: picked.destination.assetId,
        amount: units,
        // The sender's address on the origin chain is unknown, so refunds go to the user's own NEAR account.
        refundTo: account,
        refundType: "INTENTS",
        recipient: deps.vaultAccount,
        customRecipientMsg: topUpMessage(account),
        deadline,
        appFees: [],
      })
      .catch((error) => {
        throw intentsError(error, picked.source.chain);
      });
  }

  async function sources(unit: Unit, userId: string) {
    const account = await unit((tx) => vaultAccountOf(tx, userId));
    const list = deps.client ? await tokenList(deps.client).catch(() => null) : null;
    const offered = (source: Source) =>
      source.chain === "near" || Boolean(list?.some((item) => item.blockchain === ONECLICK_BLOCKCHAIN[source.chain] && item.symbol.toLowerCase() === source.token));
    return {
      sources: DEPOSIT_SOURCES.map((source) => ({
        token: source.token,
        chain: source.chain,
        group: source.group,
        minimum: formatUnits(parseUnits(source.minimum, 8) as bigint, 8),
        eta_seconds: source.etaSeconds,
        direct: source.chain === "near",
        available: offered(source),
        address: source.chain === "near" ? account : null,
      })),
    };
  }

  async function estimate(unit: Unit, userId: string, input: DepositInput) {
    const account = await unit((tx) => vaultAccountOf(tx, userId));
    if (input.chain === "near") throw invalidRequest("USDC on NEAR goes straight to your account; there is nothing to estimate.");
    const picked = await route(input.token, input.chain);
    const units = amountOf(input, picked.origin, picked.source);
    const quote = await flexQuote(true, account, picked, units, new Date(now().getTime() + picked.source.watchMinutes * 60_000));
    return {
      token: input.token,
      chain: input.chain,
      amount: formatUnits(units, picked.origin.decimals),
      minimum: formatUnits(quote.minAmountIn, picked.origin.decimals),
      fee: formatUsd(quotedFee(quote, picked.origin)),
      lands: formatUnits(quote.amountOut, picked.destination.decimals),
      eta_seconds: Math.max(quote.timeEstimateSeconds, 1),
    };
  }

  async function create(tx: Db, userId: string, input: DepositInput) {
    const account = await vaultAccountOf(tx, userId);
    if (input.chain === "near") throw invalidRequest(`Send USDC on NEAR straight to ${account}; there is no address to reserve.`);
    const picked = await route(input.token, input.chain);
    const units = amountOf(input, picked.origin, picked.source);
    const reservedUntil = new Date(now().getTime() + picked.source.watchMinutes * 60_000);
    const quote = await flexQuote(false, account, picked, units, reservedUntil);
    const row = await tx.vaultDeposit.create({
      data: {
        id: newId("dep"),
        userId,
        account,
        token: input.token,
        chain: input.chain,
        decimals: picked.origin.decimals,
        depositAddress: quote.depositAddress as string,
        depositMemo: quote.depositMemo ?? null,
        amountUnits: units,
        minimumUnits: quote.minAmountIn,
        feeMicroUsd: quotedFee(quote, picked.origin),
        landsUnits: quote.amountOut,
        etaSeconds: Math.max(quote.timeEstimateSeconds, 1),
        reservedUntil: quote.deadline ?? reservedUntil,
        quote: quote.raw as object,
      },
    });
    return depositView(row);
  }

  // The 1Click call happens outside any transaction. The row is then locked, so two pollers cannot both credit a landing.
  async function advance(unit: Unit, row: VaultDeposit): Promise<VaultDeposit> {
    let execution: OneClickExecution | undefined;
    if (deps.client) {
      execution = await deps.client.status(row.depositAddress, row.depositMemo ?? undefined).catch((error) => {
        if (error instanceof OneClickError && error.kind !== "cancelled") return undefined;
        throw error;
      });
    }
    const at = now();
    const { updated, landed } = await unit(async (tx) => {
      await tx.$queryRaw`SELECT id FROM core.vault_deposits WHERE id = ${row.id} FOR UPDATE`;
      const current = await tx.vaultDeposit.findUniqueOrThrow({ where: { id: row.id } });
      const next = nextDeposit(current, execution, at);
      const landedNow = current.state !== "landed" && next.state === "landed" && next.landedUnits !== null;
      const saved = await tx.vaultDeposit.update({ where: { id: row.id }, data: { ...next, polledAt: at, updatedAt: next.state === current.state ? current.updatedAt : at } });
      if (landedNow) {
        await postEntry(tx, vaultCredited(saved.id, saved.account, "USDC", saved.landedUnits as bigint));
        await markRequestPaid(tx, saved);
      }
      return { updated: saved, landed: landedNow };
    });
    if (landed) await deps.onLanded?.({ account: updated.account, units: updated.landedUnits as bigint, message: topUpMessage(updated.account) });
    return updated;
  }

  const due = (row: VaultDeposit, at: Date, everyMs: number) =>
    !FINAL.has(row.state) && at.getTime() - row.reservedUntil.getTime() < LATE_WINDOW_MS && (!row.polledAt || at.getTime() - row.polledAt.getTime() >= everyMs);

  async function get(unit: Unit, userId: string, depositId: string) {
    const row = await unit((tx) => tx.vaultDeposit.findFirst({ where: { id: depositId, userId } }));
    if (!row) throw notFound("No such deposit.");
    return depositView(due(row, now(), POLL_EVERY_MS) ? await advance(unit, row) : row);
  }

  async function sweep(unit: Unit, everyMs: number, limit = 50): Promise<number> {
    const at = now();
    const rows = await unit((tx) =>
      tx.vaultDeposit.findMany({
        where: {
          state: { in: ["waiting", "seen", "underpaid", "bridging", "expired"] },
          reservedUntil: { gt: new Date(at.getTime() - LATE_WINDOW_MS) },
          OR: [{ polledAt: null }, { polledAt: { lt: new Date(at.getTime() - everyMs) } }],
        },
        orderBy: { polledAt: { sort: "asc", nulls: "first" } },
        take: limit,
      }),
    );
    for (const row of rows) await advance(unit, row);
    return rows.length;
  }

  return { sources, estimate, create, get, sweep };
}

export type Deposits = ReturnType<typeof createDeposits>;

// Deposits are followed even when nobody has the app open, so a landing is credited to the ledger mirror on time.
export function startDepositWatch(unit: Unit, deposits: Deposits, intervalMs = 10_000): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await deposits.sweep(unit, intervalMs);
    } catch (error) {
      console.error("[deposits] sweep failed", (error as Error).name);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
