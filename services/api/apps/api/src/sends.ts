import type { WalletSend } from "@prisma/client";
import { baseDecode } from "near-api-js";
import { OneClickError, type OneClickClient, type OneClickExecution, type OneClickToken } from "../../../packages/chains/oneclick/index.js";
import { newId } from "../../../packages/db/src/ids.js";
import type { Db, Unit } from "./db.js";
import { formatUnits, parseUnits } from "./deposits.js";
import { ApiError, invalidRequest, notFound } from "./errors.js";
import { retrying } from "./retry.js";

// Sending USDC from a fliq account to a wallet on another network. The user moves the USDC to a NEAR Intents deposit
// address themselves, with the same two signed steps as a send to a NEAR wallet (vault withdraw, then ft_transfer),
// and NEAR Intents delivers it on the other chain. fliq never holds it. If the swap cannot complete, NEAR Intents
// sends it back to the user's own NEAR account.

export type SendChain = "solana" | "base";
export type SendState = "awaiting" | "moving" | "delivered" | "refunded" | "failed" | "expired";

type Network = { chain: SendChain; name: string; blockchain: string; minimum: string; etaSeconds: number; isAddress: (text: string) => boolean };

const isSolanaAddress = (text: string) => {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text)) return false;
  try {
    return baseDecode(text).length === 32;
  } catch {
    return false;
  }
};

// The order the app lists them in. The minimum keeps a send above what the network fee would mostly eat.
export const SEND_NETWORKS: readonly Network[] = [
  { chain: "solana", name: "Solana", blockchain: "sol", minimum: "1", etaSeconds: 40, isAddress: isSolanaAddress },
  { chain: "base", name: "Base", blockchain: "base", minimum: "1", etaSeconds: 40, isAddress: (text) => /^0x[0-9a-fA-F]{40}$/.test(text) },
];

const DECIMALS = 6;
const TOKENS_TTL_MS = 60_000;
// How long the user has to sign after seeing the quote, and how long 1Click may take before it must refund.
const SIGN_WINDOW_MS = 10 * 60_000;
const SWAP_DEADLINE_MS = 30 * 60_000;
const REFRESH_MS = 3_000;
const FOLLOW_MS = 24 * 60 * 60_000;
const QUOTE_RETRY_DELAYS_MS = [300, 800];
const FINAL: ReadonlySet<string> = new Set(["delivered", "refunded", "failed", "expired"]);

const STATE_OF: Record<OneClickExecution["status"], SendState> = {
  PENDING_DEPOSIT: "awaiting",
  KNOWN_DEPOSIT_TX: "moving",
  INCOMPLETE_DEPOSIT: "moving",
  PROCESSING: "moving",
  SUCCESS: "delivered",
  REFUNDED: "refunded",
  FAILED: "failed",
};

export interface SendInput {
  chain: string;
  address: string;
  amount: string;
}

export interface SendDeps {
  client: Pick<OneClickClient, "tokens" | "quote" | "status"> | undefined;
  usdcContract: string;
  slippageBps: number;
  // Makes sure an account can hold USDC, so the token contract accepts a transfer or a refund to it.
  tokenStorage?: { ensure(accountId: string): Promise<unknown> };
  now?: () => Date;
  pause?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

const unavailable = (name: string) => new ApiError(503, "chain_unavailable", `Sending to ${name} is not available right now. Try again in a moment.`);

export function sendView(row: WalletSend) {
  return {
    send_id: row.id,
    state: row.state as SendState,
    token: "usdc" as const,
    chain: row.chain,
    to: row.toAddress,
    amount: formatUnits(row.amountUnits, DECIMALS),
    receives: formatUnits(row.deliveredUnits ?? row.receivesUnits, DECIMALS),
    fee: formatUnits(row.amountUnits > row.receivesUnits ? row.amountUnits - row.receivesUnits : 0n, DECIMALS),
    eta_seconds: row.etaSeconds,
    deposit: { address: row.depositAddress, memo: row.depositMemo, expires_at: row.expiresAt.toISOString() },
    origin_tx: row.originTx,
    destination_tx: row.destinationTx,
    created_at: row.createdAt.toISOString(),
  };
}

export type SendView = ReturnType<typeof sendView>;

// What one 1Click answer, or the lack of one, does to a send. A final state is final.
export function nextSend(current: Pick<WalletSend, "state" | "expiresAt">, execution: OneClickExecution | undefined, now: Date): SendState {
  if (FINAL.has(current.state)) return current.state as SendState;
  const reported = execution ? STATE_OF[execution.status] : (current.state as SendState);
  // A send that is moving never goes back to waiting, or expires, because one status read was stale.
  if (current.state === "moving" && reported === "awaiting") return "moving";
  // Nothing was ever sent to the address and the window to sign has passed: nothing moved, nothing to follow.
  if (reported === "awaiting" && now > current.expiresAt) return "expired";
  return reported;
}

export function createSends(deps: SendDeps) {
  const now = deps.now ?? (() => new Date());
  let tokens: { at: number; list: OneClickToken[] } | null = null;
  const asked = new Map<string, number>();

  async function tokenList(client: NonNullable<SendDeps["client"]>): Promise<OneClickToken[]> {
    if (!tokens || now().getTime() - tokens.at > TOKENS_TTL_MS) tokens = { at: now().getTime(), list: await client.tokens() };
    return tokens.list;
  }

  async function accountOf(tx: Db, userId: string): Promise<string> {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { nearAccount: true } });
    if (!user?.nearAccount) throw notFound("Claim a fliq name to send.");
    return user.nearAccount;
  }

  function networkOf(chain: string): Network {
    const network = SEND_NETWORKS.find((item) => item.chain === chain);
    if (!network) throw invalidRequest(`fliq cannot send to ${chain} yet.`);
    return network;
  }

  async function route(network: Network) {
    if (!deps.client) throw unavailable(network.name);
    const list = await tokenList(deps.client).catch(() => {
      throw unavailable(network.name);
    });
    const origin = list.find((item) => item.blockchain === "near" && item.symbol === "USDC");
    const destination = list.find((item) => item.blockchain === network.blockchain && item.symbol === "USDC");
    if (!origin || !destination) throw unavailable(network.name);
    // The USDC the user holds is the one the vault accepts. Any other NEAR "USDC" is a different token.
    if (origin.contractAddress !== undefined && origin.contractAddress !== deps.usdcContract) throw unavailable(network.name);
    return { origin, destination, client: deps.client };
  }

  async function networks() {
    const list = deps.client ? await tokenList(deps.client).catch(() => null) : null;
    return {
      networks: SEND_NETWORKS.map((network) => ({
        chain: network.chain,
        name: network.name,
        token: "usdc" as const,
        minimum: formatUnits(parseUnits(network.minimum, DECIMALS) as bigint, DECIMALS),
        eta_seconds: network.etaSeconds,
        available: Boolean(list?.some((item) => item.blockchain === network.blockchain && item.symbol === "USDC")),
      })),
    };
  }

  // Asks NEAR Intents for the swap. Nothing is reserved and nothing moves until the user sends USDC to the deposit
  // address, so this runs outside any database transaction and a refusal is asked again before the user hears of it.
  async function quote(unit: Unit, userId: string, input: SendInput) {
    const account = await unit((tx) => accountOf(tx, userId));
    const network = networkOf(input.chain);
    const address = typeof input.address === "string" ? input.address.trim() : "";
    if (!network.isAddress(address)) throw invalidRequest(`That is not a ${network.name} address. Check it and try again.`);
    const units = typeof input.amount === "string" ? parseUnits(input.amount, DECIMALS) : null;
    if (units === null || units <= 0n) throw invalidRequest("amount must be a positive decimal string.");
    const minimum = parseUnits(network.minimum, DECIMALS) as bigint;
    if (units < minimum) throw invalidRequest(`The smallest amount you can send to ${network.name} is $${formatUnits(minimum, DECIMALS)}.`);

    const picked = await route(network);
    const at = now();
    const ask = () =>
      picked.client.quote({
        dry: false,
        swapType: "EXACT_INPUT",
        slippageBps: deps.slippageBps,
        originAsset: picked.origin.assetId,
        destinationAsset: picked.destination.assetId,
        amount: units,
        // A swap that cannot complete comes back to the user's own NEAR account, where the app offers to add it to the vault.
        refundTo: account,
        refundType: "ORIGIN_CHAIN",
        recipient: address,
        deadline: new Date(at.getTime() + SWAP_DEADLINE_MS),
        appFees: [],
      });
    const swap = await retrying(ask, {
      delaysMs: QUOTE_RETRY_DELAYS_MS,
      retryable: (error) => error instanceof OneClickError && error.kind !== "unauthorized",
      ...(deps.pause ? { pause: deps.pause } : {}),
    }).catch((error) => {
      if (!(error instanceof OneClickError)) throw error;
      deps.log?.(`[sends] quote to ${network.chain} failed after retries: ${error.message}`);
      if (error.kind === "rejected") throw invalidRequest(`NEAR Intents will not send this amount to ${network.name}. Try a larger one.`);
      throw unavailable(network.name);
    });
    if (!swap.depositAddress || swap.amountOut <= 0n) throw unavailable(network.name);

    try {
      await deps.tokenStorage?.ensure(swap.depositAddress);
      await deps.tokenStorage?.ensure(account);
    } catch {
      throw unavailable(network.name);
    }
    return { account, network, address, units, swap, at };
  }

  async function save(tx: Db, userId: string, quoted: Awaited<ReturnType<typeof quote>>): Promise<SendView> {
    const { account, network, address, units, swap, at } = quoted;
    const row = await tx.walletSend.create({
      data: {
        id: newId("snd"),
        userId,
        account,
        chain: network.chain,
        toAddress: address,
        amountUnits: units,
        receivesUnits: swap.amountOut,
        minReceivesUnits: swap.minAmountOut,
        depositAddress: swap.depositAddress as string,
        depositMemo: swap.depositMemo ?? null,
        etaSeconds: Math.max(swap.timeEstimateSeconds, 1),
        expiresAt: new Date(at.getTime() + SIGN_WINDOW_MS),
        quote: swap.raw as object,
        createdAt: at,
      },
    });
    return sendView(row);
  }

  async function follow(unit: Unit, row: WalletSend): Promise<WalletSend> {
    if (FINAL.has(row.state) || !deps.client) return row;
    let execution: OneClickExecution | undefined;
    try {
      execution = await deps.client.status(row.depositAddress, row.depositMemo ?? undefined);
    } catch (error) {
      deps.log?.(`[sends] ${row.id}: 1Click status ${(error as Error).name}`);
    }
    const state = nextSend(row, execution, now());
    const destinationTx = execution?.destinationTxHashes[0] ?? row.destinationTx;
    const originTx = row.originTx ?? execution?.nearTxHashes[0] ?? execution?.originTxHashes[0] ?? null;
    const deliveredUnits = state === "delivered" ? (execution?.amountOut ?? row.deliveredUnits) : row.deliveredUnits;
    if (state === row.state && destinationTx === row.destinationTx && originTx === row.originTx && deliveredUnits === row.deliveredUnits) return row;
    if (state === "refunded" || state === "failed") {
      deps.log?.(`[sends] ${row.id}: 1Click ${execution?.status ?? state} a send to ${row.chain}; the USDC returns to ${row.account}`);
    }
    return unit((tx) => tx.walletSend.update({ where: { id: row.id }, data: { state, destinationTx, originTx, deliveredUnits } }));
  }

  // The app polls its own send while the user watches. 1Click is asked at most every REFRESH_MS per send.
  async function get(unit: Unit, userId: string, sendId: string): Promise<SendView> {
    const row = await unit((tx) => tx.walletSend.findFirst({ where: { id: sendId, userId } }));
    if (!row) throw notFound("No such send.");
    const at = now().getTime();
    if (FINAL.has(row.state) || at - (asked.get(row.id) ?? 0) < REFRESH_MS) return sendView(row);
    asked.set(row.id, at);
    const fresh = await follow(unit, row);
    if (FINAL.has(fresh.state)) asked.delete(row.id);
    return sendView(fresh);
  }

  // Follows sends nobody is watching, so Activity is right when the user comes back.
  async function sweep(unit: Unit): Promise<number> {
    const since = new Date(now().getTime() - FOLLOW_MS);
    const open = await unit((tx) =>
      tx.walletSend.findMany({ where: { state: { in: ["awaiting", "moving"] }, createdAt: { gt: since } }, orderBy: { id: "asc" } }),
    );
    let changed = 0;
    for (const row of open) if ((await follow(unit, row)).state !== row.state) changed += 1;
    return changed;
  }

  return { networks, quote, save, get, sweep };
}

export type Sends = ReturnType<typeof createSends>;

// The user's own ft_transfer to a send's deposit address is the moment it starts moving. Recorded from the relay.
export async function markSendStarted(tx: Db, userId: string, depositAddress: string, txHash: string): Promise<boolean> {
  const send = await tx.walletSend.findUnique({ where: { depositAddress } });
  if (!send || send.userId !== userId) return false;
  if (send.state === "awaiting") await tx.walletSend.update({ where: { id: send.id }, data: { state: "moving", originTx: txHash } });
  return true;
}

export function startSendWatch(unit: Unit, sends: Sends, intervalMs: number, log: (message: string) => void): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await sends.sweep(unit);
    } catch (error) {
      log(`[sends] sweep failed: ${(error as Error).name}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
