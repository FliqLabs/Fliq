import type { OneClickClient, OneClickQuote, OneClickToken } from "../../../packages/chains/oneclick/index.js";
import type { HopPricer } from "../../../packages/domain/routing.js";
import type { Asset, Chain } from "../../../packages/providers/types.js";

// Our chain ids against the blockchain names 1Click uses.
const ONECLICK_CHAIN: Partial<Record<Chain, string>> = {
  near: "near",
  base: "base",
  polygon: "pol",
  arbitrum: "arb",
  ethereum: "eth",
  solana: "sol",
  tron: "tron",
  bnb: "bsc",
};

const TOKENS_TTL_MS = 60_000;
const DRY_DEADLINE_MS = 5 * 60_000;

export interface HopOptions {
  client: OneClickClient;
  slippageBps: number;
  // Dry quotes still need addresses, so pricing uses stand-ins and no funds can move.
  pricingRefundTo: string;
  pricingRecipient: string;
  now?: () => Date;
  cacheMs?: number;
}

export interface DepositQuoteInput {
  asset: Asset;
  from: Chain;
  to: Chain;
  amountOut: bigint;
  recipient: string;
  refundTo: string;
  deadline: Date;
}

export class OneClickHops implements HopPricer {
  readonly #options: HopOptions;
  readonly #now: () => Date;
  #tokens: { at: number; list: OneClickToken[] } | null = null;
  readonly #priced = new Map<string, { at: number; value: { amount: bigint; seconds: number } }>();

  constructor(options: HopOptions) {
    this.#options = options;
    this.#now = options.now ?? (() => new Date());
  }

  async #assetId(chain: Chain, asset: Asset): Promise<string | null> {
    const name = ONECLICK_CHAIN[chain];
    if (!name) return null;
    if (!this.#tokens || this.#now().getTime() - this.#tokens.at > TOKENS_TTL_MS) {
      this.#tokens = { at: this.#now().getTime(), list: await this.#options.client.tokens() };
    }
    return this.#tokens.list.find((token) => token.blockchain === name && token.symbol === asset)?.assetId ?? null;
  }

  async reachable(asset: Asset, from: Chain, to: Chain): Promise<boolean> {
    return (await this.#assetId(from, asset)) !== null && (await this.#assetId(to, asset)) !== null;
  }

  // Identical hops are priced once for a few seconds, so a burst of quotes makes one 1Click call.
  async #dry(swapType: "EXACT_INPUT" | "EXACT_OUTPUT", asset: Asset, from: Chain, to: Chain, amount: bigint) {
    const key = `${swapType}:${asset}:${from}:${to}:${amount}`;
    const cached = this.#priced.get(key);
    const nowMs = this.#now().getTime();
    if (cached && nowMs - cached.at < (this.#options.cacheMs ?? 10_000)) return cached.value;
    const [originAsset, destinationAsset] = await Promise.all([this.#assetId(from, asset), this.#assetId(to, asset)]);
    if (!originAsset || !destinationAsset) throw new Error("no 1Click route");
    const quote = await this.#options.client.quote({
      dry: true,
      swapType,
      slippageBps: this.#options.slippageBps,
      originAsset,
      destinationAsset,
      amount,
      refundTo: this.#options.pricingRefundTo,
      recipient: this.#options.pricingRecipient,
      deadline: new Date(nowMs + DRY_DEADLINE_MS),
      appFees: [],
    });
    const value = { amount: swapType === "EXACT_INPUT" ? quote.amountOut : quote.amountIn, seconds: quote.timeEstimateSeconds };
    this.#priced.set(key, { at: nowMs, value });
    return value;
  }

  async exactInput(asset: Asset, from: Chain, to: Chain, amountIn: bigint) {
    const priced = await this.#dry("EXACT_INPUT", asset, from, to, amountIn);
    return { amountOut: priced.amount, seconds: priced.seconds };
  }

  async exactOutput(asset: Asset, from: Chain, to: Chain, amountOut: bigint) {
    const priced = await this.#dry("EXACT_OUTPUT", asset, from, to, amountOut);
    return { amountIn: priced.amount, seconds: priced.seconds };
  }

  // The real quote: exactly what the provider needs, with the provider's address as recipient and the sender as refund address.
  async depositQuote(input: DepositQuoteInput): Promise<OneClickQuote> {
    const [originAsset, destinationAsset] = await Promise.all([this.#assetId(input.from, input.asset), this.#assetId(input.to, input.asset)]);
    if (!originAsset || !destinationAsset) throw new Error("no 1Click route");
    return this.#options.client.quote({
      dry: false,
      swapType: "EXACT_OUTPUT",
      slippageBps: this.#options.slippageBps,
      originAsset,
      destinationAsset,
      amount: input.amountOut,
      refundTo: input.refundTo,
      recipient: input.recipient,
      deadline: input.deadline,
      appFees: [],
    });
  }
}
