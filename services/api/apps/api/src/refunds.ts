import { INTENTS_CONTRACT, type IntentsBalance } from "../../../packages/chains/near/index.js";
import { OneClickError, type OneClickClient, type OneClickToken } from "../../../packages/chains/oneclick/index.js";
import { newId } from "../../../packages/db/src/ids.js";
import type { Db, Unit } from "./db.js";
import { ONECLICK_BLOCKCHAIN, formatUnits, quotedFee, topUpMessage, vaultAccountOf, type DepositChain } from "./deposits.js";
import { ApiError, invalidRequest } from "./errors.js";
import { retrying } from "./retry.js";

// A deposit 1Click could not finish is refunded to the user's NEAR Intents balance, which the app cannot see or
// move by itself. These find such balances and quote their way back into the vault; the app signs the transfer.

const TOKENS_TTL_MS = 60_000;
const QUOTE_RETRY_DELAYS_MS = [300, 800];
const RETURN_WINDOW_MS = 30 * 60_000;
const DOLLARS = new Set(["USDC", "USDT"]);
// Five cents: less is not worth a transfer, and 1Click will not quote it.
const DUST_CENTS = 5n;

export interface RefundDeps {
  client: OneClickClient | undefined;
  vaultAccount: string;
  usdcContract: string;
  slippageBps: number;
  // Reads an account's NEAR Intents balances. Absent without a NEAR RPC, and then there is nothing to show.
  balances?: (account: string) => Promise<IntentsBalance[]>;
  intentsContract?: string;
  now?: () => Date;
  pause?: (ms: number) => Promise<void>;
}

type Stranded = { token: OneClickToken; chain: DepositChain; units: bigint };

const CHAIN_OF = new Map(Object.entries(ONECLICK_BLOCKCHAIN).map(([chain, blockchain]) => [blockchain, chain as DepositChain]));

const dust = (decimals: number) => (decimals >= 2 ? DUST_CENTS * 10n ** BigInt(decimals - 2) : 1n);

const unavailable = () => new ApiError(503, "route_unavailable", "Bringing refunds back is not available right now. Try again in a moment.");

export function createRefunds(deps: RefundDeps) {
  const now = deps.now ?? (() => new Date());
  const intentsContract = deps.intentsContract ?? INTENTS_CONTRACT;
  let tokens: { at: number; list: OneClickToken[] } | null = null;

  async function tokenList(client: OneClickClient): Promise<OneClickToken[]> {
    if (!tokens || now().getTime() - tokens.at > TOKENS_TTL_MS) tokens = { at: now().getTime(), list: await client.tokens() };
    return tokens.list;
  }

  async function stranded(account: string): Promise<{ held: Stranded[]; list: OneClickToken[]; client: OneClickClient }> {
    if (!deps.client || !deps.balances) throw unavailable();
    const client = deps.client;
    const [balances, list] = await Promise.all([deps.balances(account), tokenList(client)]).catch((error) => {
      console.error("[refunds] balance read failed", (error as Error).message);
      throw unavailable();
    });
    const held = balances.flatMap(({ tokenId, units }) => {
      const token = list.find((item) => item.assetId === tokenId);
      const chain = token ? CHAIN_OF.get(token.blockchain) : undefined;
      if (!token || !chain || !DOLLARS.has(token.symbol.toUpperCase()) || units < dust(token.decimals)) return [];
      return [{ token, chain, units }];
    });
    return { held, list, client };
  }

  const itemOf = ({ token, chain, units }: Stranded) => ({
    token_id: token.assetId,
    symbol: token.symbol.toLowerCase(),
    chain,
    units: units.toString(),
    amount: formatUnits(units, token.decimals),
    intents_contract: intentsContract,
  });

  async function list(unit: Unit, userId: string) {
    const account = await unit((tx) => vaultAccountOf(tx, userId));
    if (!deps.client || !deps.balances) return { items: [] };
    return { items: (await stranded(account)).held.map(itemOf) };
  }

  // The whole balance goes back as one EXACT_INPUT quote taken from the Intents balance. It lands like a top-up, so
  // the deposit watcher follows it to the vault; if 1Click refunds it again, it is back on this list.
  async function bringBack(tx: Db, userId: string, tokenId: string) {
    const account = await vaultAccountOf(tx, userId);
    const { held, list: known, client } = await stranded(account);
    const found = held.find((item) => item.token.assetId === tokenId);
    if (!found) throw invalidRequest("There is no refund in that token to bring back.");
    const destination = known.find((item) => item.blockchain === "near" && item.symbol === "USDC");
    if (!destination || (destination.contractAddress !== undefined && destination.contractAddress !== deps.usdcContract)) throw unavailable();
    const deadline = new Date(now().getTime() + RETURN_WINDOW_MS);
    const quote = await retrying(
      () =>
        client.quote({
          dry: false,
          swapType: "EXACT_INPUT",
          depositType: "INTENTS",
          slippageBps: deps.slippageBps,
          originAsset: found.token.assetId,
          destinationAsset: destination.assetId,
          amount: found.units,
          refundTo: account,
          refundType: "INTENTS",
          recipient: deps.vaultAccount,
          customRecipientMsg: topUpMessage(account),
          deadline,
          appFees: [],
        }),
      {
        delaysMs: QUOTE_RETRY_DELAYS_MS,
        retryable: (error) => error instanceof OneClickError && error.kind !== "unauthorized",
        ...(deps.pause ? { pause: deps.pause } : {}),
      },
    ).catch((error) => {
      if (!(error instanceof OneClickError)) throw error;
      console.error(`[refunds] quote failed after retries: ${error.message}`);
      throw error.kind === "rejected" ? invalidRequest("NEAR Intents will not take this refund back right now.") : unavailable();
    });
    if (!quote.depositAddress) throw unavailable();
    const row = await tx.vaultDeposit.create({
      data: {
        id: newId("dep"),
        userId,
        account,
        token: found.token.symbol.toLowerCase(),
        chain: found.chain,
        decimals: found.token.decimals,
        depositAddress: quote.depositAddress,
        depositMemo: quote.depositMemo ?? null,
        amountUnits: found.units,
        minimumUnits: found.units,
        feeMicroUsd: quotedFee(quote, found.token),
        landsUnits: quote.amountOut,
        etaSeconds: Math.max(quote.timeEstimateSeconds, 1),
        reservedUntil: quote.deadline ?? deadline,
        refundReturn: true,
        quote: quote.raw as object,
      },
    });
    return {
      deposit_id: row.id,
      deposit_address: row.depositAddress,
      token_id: found.token.assetId,
      units: found.units.toString(),
      lands: formatUnits(quote.amountOut, destination.decimals),
      intents_contract: intentsContract,
    };
  }

  return { list, bringBack };
}

export type Refunds = ReturnType<typeof createRefunds>;
