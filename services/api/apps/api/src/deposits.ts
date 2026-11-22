import { randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma, type DepositState, type VaultDeposit } from "@prisma/client";
import { OneClickError, type OneClickClient, type OneClickExecution, type OneClickQuote, type OneClickToken } from "../../../packages/chains/oneclick/index.js";
import type { Arrival } from "../../../packages/chains/watchers/index.js";
import { newId } from "../../../packages/db/src/ids.js";
import { postEntry } from "../../../packages/ledger/post.js";
import { vaultCredited } from "../../../packages/ledger/postings.js";
import type { Db, Unit } from "./db.js";
import { ApiError, invalidRequest, notFound } from "./errors.js";
import { retrying } from "./retry.js";
import { markRequestPaid } from "./requests.js";

export type DepositToken = "usdc" | "usdt" | "btc" | "sol" | "eth" | "bnb";
export type DepositChain = "base" | "solana" | "tron" | "arbitrum" | "ethereum" | "polygon" | "bnb" | "monad" | "bitcoin" | "near";

interface Source {
  token: DepositToken;
  chain: DepositChain;
  // coins: a chain's own coin (SOL, ETH, BNB), swapped to USDC on arrival like bitcoin, so its dollar value is set then.
  group: "dollars" | "bitcoin" | "coins" | "near";
  minimum: string;
  etaSeconds: number;
  watchMinutes: number;
}

// Display order of the receive screen. Tron's floor is high because its network fee is.
export const DEPOSIT_SOURCES: readonly Source[] = [
  { token: "usdc", chain: "base", group: "dollars", minimum: "1", etaSeconds: 35, watchMinutes: 10 },
  { token: "usdc", chain: "solana", group: "dollars", minimum: "1", etaSeconds: 35, watchMinutes: 10 },
  { token: "usdc", chain: "arbitrum", group: "dollars", minimum: "1", etaSeconds: 35, watchMinutes: 10 },
  { token: "usdc", chain: "ethereum", group: "dollars", minimum: "1", etaSeconds: 90, watchMinutes: 10 },
  { token: "usdc", chain: "polygon", group: "dollars", minimum: "1", etaSeconds: 35, watchMinutes: 10 },
  { token: "usdc", chain: "bnb", group: "dollars", minimum: "1", etaSeconds: 40, watchMinutes: 10 },
  { token: "usdc", chain: "monad", group: "dollars", minimum: "1", etaSeconds: 25, watchMinutes: 10 },
  { token: "usdt", chain: "solana", group: "dollars", minimum: "1", etaSeconds: 25, watchMinutes: 10 },
  { token: "usdt", chain: "ethereum", group: "dollars", minimum: "1", etaSeconds: 90, watchMinutes: 10 },
  { token: "usdt", chain: "bnb", group: "dollars", minimum: "1", etaSeconds: 40, watchMinutes: 10 },
  { token: "usdt", chain: "polygon", group: "dollars", minimum: "1", etaSeconds: 35, watchMinutes: 10 },
  // 1Click refuses Tron swaps under $100 for now, and its fee takes a $100 deposit just under the line.
  { token: "usdt", chain: "tron", group: "dollars", minimum: "110", etaSeconds: 60, watchMinutes: 10 },
  { token: "btc", chain: "bitcoin", group: "bitcoin", minimum: "0.0001", etaSeconds: 600, watchMinutes: 60 },
  // Minimums sit near $2 at November 2026 prices, above what the network fee and the swap take. Ethereum's own fee is
  // higher, so its floor is too.
  { token: "sol", chain: "solana", group: "coins", minimum: "0.03", etaSeconds: 40, watchMinutes: 10 },
  { token: "eth", chain: "base", group: "coins", minimum: "0.0012", etaSeconds: 40, watchMinutes: 10 },
  { token: "eth", chain: "arbitrum", group: "coins", minimum: "0.0012", etaSeconds: 40, watchMinutes: 10 },
  { token: "eth", chain: "ethereum", group: "coins", minimum: "0.003", etaSeconds: 90, watchMinutes: 10 },
  { token: "bnb", chain: "bnb", group: "coins", minimum: "0.004", etaSeconds: 45, watchMinutes: 10 },
  { token: "usdc", chain: "near", group: "near", minimum: "0.01", etaSeconds: 2, watchMinutes: 0 },
];

export const ONECLICK_BLOCKCHAIN: Record<DepositChain, string> = {
  base: "base",
  solana: "sol",
  tron: "tron",
  arbitrum: "arb",
  ethereum: "eth",
  polygon: "pol",
  bnb: "bsc",
  monad: "monad",
  bitcoin: "btc",
  near: "near",
};

const TOKENS_TTL_MS = 60_000;
const POLL_EVERY_MS = 3_000;
const QUOTE_RETRY_DELAYS_MS = [300, 800];
// A deposit that arrives after its address expired is still refunded by 1Click, so it is followed this long.
const LATE_WINDOW_MS = 24 * 60 * 60_000;
const USD_DECIMALS = 6;
// Ten cents: the least a dollar deposit address is quoted for, so a short delivery still lands.
const ADDRESS_FLOOR_UNITS = 100_000n;
const FINAL: ReadonlySet<DepositState> = new Set(["landed", "refunded", "failed"]);

export interface DepositDeps {
  client: OneClickClient | undefined;
  // The vault contract receives every top-up; the message names whose balance it credits.
  vaultAccount: string;
  usdcContract: string;
  slippageBps: number;
  now?: () => Date;
  // The wait between quote attempts. Tests replace it so they do not sleep.
  pause?: (ms: number) => Promise<void>;
  // Reads the sending chain directly, so the user hears their money came before 1Click notices it.
  arrivals?: Partial<Record<DepositChain, (deposit: { address: string; mint: string; since: Date }) => Promise<Arrival | null>>>;
  // On chain, 1Click's ft_transfer_call has already credited the vault. A stand-in vault has to be told.
  onLanded?: (landing: { account: string; units: bigint; message: string }) => Promise<void> | void;
  // Tells the team when a deposit ends without reaching the vault, so they hear it before the user writes in.
  alert?: (message: string) => void;
  // This API's public address. A bank deposit hands the partner a webhook link under it; without one, only the
  // app's own reports keep the deposit's bank status.
  publicBaseUrl?: string;
}

// The bank partner's order states. Its docs call ERROR final, but on 20 Nov an order went ERROR and then COMPLETED
// ten minutes later, and landed. So ERROR is a retry in progress: it only becomes a problem if nothing lands within
// BANK_ERROR_GRACE_MS. FAILED is the only status taken as the end. Anything else is kept as written and shown as moving.
export type BankStatus = "INIT" | "PAID" | "PROCESSING" | "COMPLETED" | "ERROR" | "FAILED" | "CANCELLED";
const BANK_STOPPED: ReadonlySet<string> = new Set(["FAILED"]);
// After the user says they sent the money, the partner usually reports PAID within minutes. An hour is a problem.
export const BANK_OVERDUE_MS = 60 * 60_000;
// How long an ERROR may last before the team hears of it. The 20 Nov order recovered in about ten minutes.
export const BANK_ERROR_GRACE_MS = 15 * 60_000;

export interface BankReport {
  order_id: string;
  status?: string;
  sent?: boolean;
}

export interface DepositInput {
  token: DepositToken;
  chain: DepositChain;
  amount: string;
  via?: "wallet" | "bank";
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

export function quotedFee(quote: OneClickQuote, source: OneClickToken): bigint {
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

// Source-token units are NUMERIC in the database (18-decimal tokens overflow BIGINT) and bigint everywhere in code.
export const units = (value: Prisma.Decimal): bigint => BigInt(value.toFixed(0));
export const unitsOrNull = (value: Prisma.Decimal | null): bigint | null => (value === null ? null : units(value));
export const numeric = (value: bigint): Prisma.Decimal => new Prisma.Decimal(value.toString());
const numericOrNull = (value: bigint | null): Prisma.Decimal | null => (value === null ? null : numeric(value));

type Tracked = Pick<VaultDeposit, "state" | "reservedUntil" | "landedUnits" | "refundReason" | "originTx" | "seenAt" | "bridgingAt" | "landedAt" | "intentsStatus"> & {
  receivedUnits: bigint | null;
  refundedUnits: bigint | null;
};

const tracked = (row: VaultDeposit): Tracked => ({ ...row, receivedUnits: unitsOrNull(row.receivedUnits), refundedUnits: unitsOrNull(row.refundedUnits) });

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

// The line the team gets when a deposit ends somewhere other than the vault, or null when it did not just do so.
export function depositProblem(before: DepositState, after: VaultDeposit): string | null {
  if (before === after.state || (after.state !== "refunded" && after.state !== "failed")) return null;
  const what = `${after.token.toUpperCase()} from ${after.chain}`;
  if (after.state === "failed") return `deposit ${after.id} failed: ${what} for ${after.account}. Check it in 1Click.`;
  const amount = after.refundedUnits === null ? "the money" : formatUnits(units(after.refundedUnits), after.decimals);
  const reason = after.refundReason ? ` (${after.refundReason})` : "";
  return `deposit ${after.id} refunded${reason}: ${amount} ${what} went back to ${after.account}. The app returns it to their vault.`;
}

export function bankWebhookUrl(base: string | undefined, row: Pick<VaultDeposit, "id" | "bankHookToken">): string | null {
  if (!base || !row.bankHookToken) return null;
  return `${base.replace(/\/+$/, "")}/v1/bank-deposits/${row.id}/${row.bankHookToken}`;
}

// The line the team gets when a bank deposit stops at the partner. Null when nothing new went wrong.
export function bankProblem(row: Pick<VaultDeposit, "id" | "account" | "bankOrderId" | "bankStatus" | "landedAt" | "bankAlertedAt">): string | null {
  if (row.bankAlertedAt || row.landedAt || !row.bankStatus || !BANK_STOPPED.has(row.bankStatus)) return null;
  return `bank deposit ${row.id} for ${row.account}: the bank partner marked order ${row.bankOrderId ?? "(unknown)"} ${row.bankStatus}. If the user paid, the naira is with the partner: ask it to complete or refund the order.`;
}

export function depositView(row: VaultDeposit, publicBaseUrl?: string) {
  const usdc = (units: bigint | null) => (units === null ? null : formatUnits(units, USD_DECIMALS));
  const source = (units: bigint | null) => (units === null ? null : formatUnits(units, row.decimals));
  return {
    deposit_id: row.id,
    state: row.state,
    token: row.token,
    chain: row.chain,
    address: row.depositAddress,
    memo: row.depositMemo,
    amount: formatUnits(units(row.amountUnits), row.decimals),
    minimum: formatUnits(units(row.minimumUnits), row.decimals),
    fee: formatUsd(row.feeMicroUsd),
    lands: formatUnits(row.landsUnits, USD_DECIMALS),
    eta_seconds: row.etaSeconds,
    reserved_until: row.reservedUntil.toISOString(),
    received: source(unitsOrNull(row.receivedUnits)),
    landed: usdc(row.landedUnits),
    refunded: source(unitsOrNull(row.refundedUnits)),
    seen_at: row.seenAt?.toISOString() ?? null,
    bridging_at: row.bridgingAt?.toISOString() ?? null,
    landed_at: row.landedAt?.toISOString() ?? null,
    seconds: row.seenAt && row.landedAt ? Math.round((row.landedAt.getTime() - row.seenAt.getTime()) / 1000) : null,
    origin_tx: row.originTx,
    created_at: row.createdAt.toISOString(),
    bank_status: row.bankStatus,
    bank_webhook_url: bankWebhookUrl(publicBaseUrl, row),
  };
}

const unavailable = (chain: string) => new ApiError(503, "route_unavailable", `Receiving from ${chain} is not available right now. Try again in a moment.`);

function intentsError(error: unknown, chain: string): ApiError {
  if (error instanceof OneClickError && error.kind === "rejected") return invalidRequest(`NEAR Intents will not take this amount from ${chain}.`);
  if (error instanceof OneClickError) return unavailable(chain);
  throw error;
}

export async function vaultAccountOf(tx: Db, userId: string): Promise<string> {
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

  // A quote reserves nothing and moves nothing, so a refusal or a dropped call is asked again before the user hears
  // of it: 1Click has refused a request and accepted the same one seconds later. A refused key is not retried.
  async function flexQuote(dry: boolean, account: string, picked: Awaited<ReturnType<typeof route>>, units: bigint, deadline: Date) {
    const ask = () =>
      picked.client.quote({
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
      });
    return retrying(ask, {
      delaysMs: QUOTE_RETRY_DELAYS_MS,
      retryable: (error) => error instanceof OneClickError && error.kind !== "unauthorized",
      ...(deps.pause ? { pause: deps.pause } : {}),
    }).catch((error) => {
      if (error instanceof OneClickError) console.error(`[deposits] quote from ${picked.source.chain} failed after retries: ${error.message}`);
      throw intentsError(error, picked.source.chain);
    });
  }

  // A FLEX_INPUT address refunds anything under 99% of the amount it was quoted for. A bank partner or an exchange
  // can deliver a little less than the user typed after its own fees, and that came back as a refund the app could
  // not see (17 Nov). So a dollar address is quoted for a token floor: anything from it up lands in the vault. A route
  // that will not quote so little (Tron's flat fee) keeps the amount the user asked for.
  async function addressQuote(account: string, picked: Awaited<ReturnType<typeof route>>, units: bigint, deadline: Date) {
    const floor = picked.origin.decimals === USD_DECIMALS ? ADDRESS_FLOOR_UNITS : null;
    if (floor !== null && floor < units) {
      const low = await quoteOnce(account, picked, floor, deadline);
      if (low) return low;
    }
    return flexQuote(false, account, picked, units, deadline);
  }

  async function quoteOnce(account: string, picked: Awaited<ReturnType<typeof route>>, units: bigint, deadline: Date) {
    return picked.client
      .quote({
        dry: false,
        swapType: "FLEX_INPUT",
        slippageBps: deps.slippageBps,
        originAsset: picked.origin.assetId,
        destinationAsset: picked.destination.assetId,
        amount: units,
        refundTo: account,
        refundType: "INTENTS",
        recipient: deps.vaultAccount,
        customRecipientMsg: topUpMessage(account),
        deadline,
        appFees: [],
      })
      .catch(() => null);
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
    const quote = await addressQuote(account, picked, units, reservedUntil);
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
        amountUnits: numeric(units),
        fromBank: input.via === "bank",
        bankHookToken: input.via === "bank" ? randomBytes(24).toString("base64url") : null,
        minimumUnits: numeric(quote.minAmountIn),
        feeMicroUsd: quotedFee(quote, picked.origin),
        landsUnits: quote.amountOut,
        etaSeconds: Math.max(quote.timeEstimateSeconds, 1),
        reservedUntil: quote.deadline ?? reservedUntil,
        quote: quote.raw as object,
      },
    });
    return depositView(row, deps.publicBaseUrl);
  }

  async function arrival(row: VaultDeposit): Promise<Arrival | null> {
    const look = deps.arrivals?.[row.chain as DepositChain];
    // A returned refund moves on the NEAR Intents contract, so its address is never on the origin chain.
    if (!look || !deps.client || row.refundReturn) return null;
    try {
      const list = await tokenList(deps.client);
      const mint = list.find((item) => item.blockchain === ONECLICK_BLOCKCHAIN[row.chain as DepositChain] && item.symbol.toLowerCase() === row.token)?.contractAddress;
      const found = mint ? await look({ address: row.depositAddress, mint, since: row.createdAt }) : null;
      // 1Click decides what a short payment becomes, so one is left for it to report.
      return found && found.amount >= units(row.minimumUnits) ? found : null;
    } catch (error) {
      console.error("[deposits] origin lookup failed", (error as Error).message);
      return null;
    }
  }

  // 1Click's docs say naming the transaction can speed it up. It is only a hint: polling carries on whatever the answer.
  function tellOneClick(row: VaultDeposit) {
    void deps.client
      ?.submitDeposit({ txHash: row.originTx as string, depositAddress: row.depositAddress, ...(row.depositMemo ? { memo: row.depositMemo } : {}) })
      .catch((error) => console.error("[deposits] deposit submit failed", (error as Error).message));
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
    const arrived = execution?.status === "PENDING_DEPOSIT" && row.state === "waiting" ? await arrival(row) : null;
    const at = now();
    const { updated, landed, sighted, problem } = await unit(async (tx) => {
      await tx.$queryRaw`SELECT id FROM core.vault_deposits WHERE id = ${row.id} FOR UPDATE`;
      const current = await tx.vaultDeposit.findUniqueOrThrow({ where: { id: row.id } });
      const followed = nextDeposit(tracked(current), execution, at);
      // Our own sighting only changes what the user is told. The balance is credited when 1Click delivers, below.
      const sightedNow = arrived !== null && followed.state === "waiting";
      const next = sightedNow ? { ...followed, state: "seen" as const, receivedUnits: arrived.amount, originTx: arrived.txHash, seenAt: at } : followed;
      const landedNow = current.state !== "landed" && next.state === "landed" && next.landedUnits !== null;
      const data = { ...next, receivedUnits: numericOrNull(next.receivedUnits), refundedUnits: numericOrNull(next.refundedUnits) };
      const saved = await tx.vaultDeposit.update({ where: { id: row.id }, data: { ...data, polledAt: at, updatedAt: next.state === current.state ? current.updatedAt : at } });
      if (landedNow) {
        await postEntry(tx, vaultCredited(saved.id, saved.account, "USDC", saved.landedUnits as bigint));
        await markRequestPaid(tx, saved);
      }
      return { updated: saved, landed: landedNow, sighted: sightedNow, problem: depositProblem(current.state, saved) };
    });
    if (problem) deps.alert?.(problem);
    if (sighted) tellOneClick(updated);
    if (landed) await deps.onLanded?.({ account: updated.account, units: updated.landedUnits as bigint, message: topUpMessage(updated.account) });
    return updated;
  }

  const due = (row: VaultDeposit, at: Date, everyMs: number) =>
    !FINAL.has(row.state) && at.getTime() - row.reservedUntil.getTime() < LATE_WINDOW_MS && (!row.polledAt || at.getTime() - row.polledAt.getTime() >= everyMs);

  async function get(unit: Unit, userId: string, depositId: string) {
    const row = await unit((tx) => tx.vaultDeposit.findFirst({ where: { id: depositId, userId } }));
    if (!row) throw notFound("No such deposit.");
    return depositView(due(row, now(), POLL_EVERY_MS) ? await advance(unit, row) : row, deps.publicBaseUrl);
  }

  // One status for a bank deposit, from the app or from the partner's webhook. A deposit that has landed keeps its
  // story: a late or replayed status cannot make it look stuck. The row is locked so two reports cannot both alert.
  async function applyBank(unit: Unit, depositId: string, change: { orderId?: string; status?: string; sent?: boolean }, owner?: string) {
    const at = now();
    const { saved, problem } = await unit(async (tx) => {
      await tx.$queryRaw`SELECT id FROM core.vault_deposits WHERE id = ${depositId} FOR UPDATE`;
      const current = await tx.vaultDeposit.findFirst({ where: { id: depositId, fromBank: true, ...(owner ? { userId: owner } : {}) } });
      if (!current) throw notFound("No such bank deposit.");
      if (change.orderId && current.bankOrderId && change.orderId !== current.bankOrderId) {
        throw invalidRequest("This deposit already belongs to another bank order.");
      }
      const status = change.status?.trim().toUpperCase().slice(0, 32) || null;
      const moved = status !== null && status !== current.bankStatus && current.state !== "landed";
      const next = await tx.vaultDeposit.update({
        where: { id: depositId },
        data: {
          bankOrderId: current.bankOrderId ?? change.orderId ?? null,
          ...(moved ? { bankStatus: status, bankStatusAt: at } : {}),
          ...(change.sent && !current.bankSentAt ? { bankSentAt: at } : {}),
        },
      });
      const line = bankProblem(next);
      if (!line) return { saved: next, problem: null };
      return { saved: await tx.vaultDeposit.update({ where: { id: depositId }, data: { bankAlertedAt: at } }), problem: line };
    });
    if (problem) deps.alert?.(problem);
    return saved;
  }

  async function reportBank(unit: Unit, userId: string, depositId: string, report: BankReport) {
    const orderId = typeof report.order_id === "string" ? report.order_id.trim() : "";
    if (!orderId || orderId.length > 128) throw invalidRequest("order_id is required.");
    const saved = await applyBank(unit, depositId, { orderId, ...(report.status ? { status: report.status } : {}), sent: report.sent === true }, userId);
    return depositView(saved, deps.publicBaseUrl);
  }

  // The partner signs nothing, so the link itself is the proof: a token only this deposit's link carries, compared in
  // constant time. A status from it changes what the user is shown, never money: the vault is credited from the chain.
  async function bankWebhook(unit: Unit, depositId: string, token: string, rawBody: string): Promise<boolean> {
    const row = await unit((tx) => tx.vaultDeposit.findFirst({ where: { id: depositId, fromBank: true }, select: { bankHookToken: true } }));
    const expected = Buffer.from(row?.bankHookToken ?? "");
    const given = Buffer.from(token);
    if (!row?.bankHookToken || expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
    let body: { id?: unknown; status?: unknown };
    try {
      body = JSON.parse(rawBody) as { id?: unknown; status?: unknown };
    } catch {
      throw invalidRequest("The body is not valid JSON.");
    }
    if (typeof body.status !== "string") throw invalidRequest("status is required.");
    await applyBank(unit, depositId, { ...(typeof body.id === "string" ? { orderId: body.id } : {}), status: body.status });
    return true;
  }

  // Told to the team once, and nothing here moves money: a bank deposit the user sent an hour ago that the partner
  // still has at INIT, and one the partner has had at ERROR for BANK_ERROR_GRACE_MS without it landing.
  async function overdueBank(unit: Unit, limit = 20): Promise<number> {
    const at = now();
    const rows = await unit((tx) =>
      tx.vaultDeposit.findMany({
        where: {
          fromBank: true,
          bankAlertedAt: null,
          landedAt: null,
          createdAt: { gt: new Date(at.getTime() - LATE_WINDOW_MS) },
          OR: [
            { bankSentAt: { lt: new Date(at.getTime() - BANK_OVERDUE_MS) }, OR: [{ bankStatus: null }, { bankStatus: "INIT" }] },
            { bankStatus: "ERROR", bankStatusAt: { lt: new Date(at.getTime() - BANK_ERROR_GRACE_MS) } },
          ],
        },
        take: limit,
      }),
    );
    for (const row of rows) {
      await unit((tx) => tx.vaultDeposit.update({ where: { id: row.id }, data: { bankAlertedAt: at } }));
      const order = row.bankOrderId ?? "(unknown)";
      if (row.bankStatus === "ERROR") {
        const minutes = Math.round((at.getTime() - (row.bankStatusAt as Date).getTime()) / 60_000);
        deps.alert?.(
          `bank deposit ${row.id} for ${row.account}: the bank partner has had order ${order} at ERROR for ${minutes} min and nothing has landed. If the user paid, ask the partner to complete or refund it.`,
        );
        continue;
      }
      const minutes = Math.round((at.getTime() - (row.bankSentAt as Date).getTime()) / 60_000);
      deps.alert?.(
        `bank deposit ${row.id} for ${row.account}: sent ${minutes} min ago and the bank partner still has order ${order} at ${row.bankStatus ?? "no status"}. Check it on the partner's dashboard.`,
      );
    }
    return rows.length;
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
    // One deposit that cannot be saved must not hold up the rest: the oldest-polled row comes first, so a row that
    // fails every time would stall every deposit behind it (22 Nov). It is marked polled, moved to the back, and the
    // team is told; the others carry on.
    for (const row of rows) {
      try {
        await advance(unit, row);
      } catch (error) {
        await unit((tx) => tx.vaultDeposit.update({ where: { id: row.id }, data: { polledAt: at } })).catch(() => undefined);
        deps.alert?.(`deposit ${row.id} for ${row.account} could not be followed: ${(error as Error).name}. The others carry on.`);
      }
    }
    return rows.length;
  }

  return { sources, estimate, create, get, sweep, reportBank, bankWebhook, overdueBank };
}

export type Deposits = ReturnType<typeof createDeposits>;

// Deposits are followed even when nobody has the app open, so a landing is credited to the ledger mirror on time.
export function startDepositWatch(
  unit: Unit,
  deposits: Deposits,
  intervalMs = 10_000,
  log: (message: string) => void = (message) => console.error(message),
): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await deposits.sweep(unit, intervalMs);
      await deposits.overdueBank(unit);
    } catch (error) {
      log(`[deposits] sweep failed: ${(error as Error).name}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
