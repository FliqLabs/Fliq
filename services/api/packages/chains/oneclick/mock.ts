import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { OneClickStatus } from "./types";

// A deterministic stand-in for the 1Click API in local and sandbox runs. It speaks the same paths and shapes as
// 1Click OpenAPI 0.1.10, prices stablecoins 1:1, and picks each swap's outcome from the requested amount:
// ending in 01 refunds, 02 fails, 03 is held in PROCESSING, anything else succeeds. A FLEX_INPUT swap pays out on
// what was deposited, and takes anything from the quoted amount less slippage.

// The stablecoins live 1Click listed for these chains on 3 November 2026 (no USDT on Base).
const CHAINS: Record<string, readonly string[]> = {
  base: ["USDC"],
  pol: ["USDC", "USDT"],
  arb: ["USDC"],
  eth: ["USDC", "USDT"],
  sol: ["USDC", "USDT"],
  tron: ["USDT"],
  near: ["USDC", "USDT"],
};
const DECIMALS = 6;
const BPS = 10_000n;
const SWAP_TYPES = ["EXACT_INPUT", "EXACT_OUTPUT", "FLEX_INPUT"];

export const MOCK_MIN_AMOUNT = 1_000_000n;

export type OneClickMockOptions = {
  now: () => Date;
  feeBps?: bigint;
  processingAfterMs?: number;
  settleAfterMs?: number;
};

type Outcome = "SUCCESS" | "REFUNDED" | "FAILED" | "HELD";
type Reply = [number, unknown];

type Swap = {
  request: Record<string, unknown>;
  quote: Record<string, unknown>;
  minAmountIn: bigint;
  amountOut: bigint;
  fees: bigint;
  flex: boolean;
  deadline: Date;
  outcome: Outcome;
  deposit: { amount: bigint; at: Date; txHash: string } | null;
};

export function mockAssetId(chain: string, symbol: string): string {
  return `mock:${chain}:${symbol.toLowerCase()}`;
}

export function createOneClickMock(options: OneClickMockOptions) {
  const feeBps = options.feeBps ?? 10n;
  const processingAfterMs = options.processingAfterMs ?? 2_000;
  const settleAfterMs = options.settleAfterMs ?? 30_000;
  const swaps = new Map<string, Swap>();
  let counter = 0;

  function tokens(): unknown[] {
    const priceUpdatedAt = options.now().toISOString();
    return Object.entries(CHAINS).flatMap(([blockchain, symbols]) =>
      symbols.map((symbol) => ({
        assetId: mockAssetId(blockchain, symbol),
        decimals: DECIMALS,
        blockchain,
        symbol,
        price: 1,
        priceUpdatedAt,
      })),
    );
  }

  function quote(body: Record<string, unknown>): Reply {
    const problem = validateQuote(body, options.now());
    if (problem) return [400, { message: problem }];
    const amount = BigInt(body.amount as string);
    if (amount < MOCK_MIN_AMOUNT) {
      return [400, { message: `Amount is too low for bridge, try at least ${MOCK_MIN_AMOUNT}` }];
    }
    const slippage = BigInt(body.slippageTolerance as number);
    const appFees = (body.appFees as { fee: number }[] | undefined) ?? [];
    const fees = feeBps + appFees.reduce((sum, fee) => sum + BigInt(fee.fee), 0n);
    const exactOutput = body.swapType === "EXACT_OUTPUT";
    const flex = body.swapType === "FLEX_INPUT";
    const amountOut = exactOutput ? amount : (amount * BPS) / (BPS + fees);
    const minAmountIn = exactOutput
      ? ceilDiv(amount * (BPS + fees), BPS)
      : flex
        ? (amount * (BPS - slippage)) / BPS
        : amount;
    const amountIn = exactOutput ? ceilDiv(minAmountIn * (BPS + slippage), BPS) : amount;
    const minAmountOut = exactOutput ? amountOut : (amountOut * (BPS - slippage)) / BPS;
    const deadline = new Date(body.deadline as string);

    const quote: Record<string, unknown> = {
      amountIn: amountIn.toString(),
      amountInFormatted: formatUnits(amountIn),
      amountInUsd: formatUnits(amountIn),
      minAmountIn: minAmountIn.toString(),
      amountOut: amountOut.toString(),
      amountOutFormatted: formatUnits(amountOut),
      amountOutUsd: formatUnits(amountOut),
      minAmountOut: minAmountOut.toString(),
      timeEstimate: Math.ceil(settleAfterMs / 1000),
    };
    if (body.dry !== true) {
      counter += 1;
      const depositAddress = mockAddress(String(body.originAsset), `${counter}:${JSON.stringify(body)}`);
      quote.depositAddress = depositAddress;
      quote.deadline = deadline.toISOString();
      quote.timeWhenInactive = deadline.toISOString();
      const outcome = outcomeFor(amount);
      swaps.set(depositAddress, {
        request: body,
        quote,
        minAmountIn,
        amountOut,
        fees,
        flex,
        deadline,
        outcome,
        deposit: null,
      });
    }
    return [201, envelope(body, quote)];
  }

  function recordDeposit(depositAddress: string, amount: bigint | null, txHash: string): Reply {
    const swap = swaps.get(depositAddress);
    if (!swap) return [404, { message: "Deposit address not found" }];
    swap.deposit ??= { amount: amount ?? BigInt(swap.quote.amountIn as string), at: options.now(), txHash };
    return [200, execution(swap)];
  }

  function status(depositAddress: string): Reply {
    const swap = swaps.get(depositAddress);
    return swap ? [200, execution(swap)] : [404, { message: "Deposit address not found" }];
  }

  function execution(swap: Swap): unknown {
    const { status, updatedAt } = progress(swap);
    const deposited = swap.deposit?.amount;
    const details: Record<string, unknown> = {
      intentHashes: [],
      nearTxHashes: [],
      originChainTxHashes: swap.deposit ? [{ hash: swap.deposit.txHash, explorerUrl: "" }] : [],
      destinationChainTxHashes: [],
    };
    if (deposited !== undefined) details.depositedAmount = deposited.toString();
    if (status === "SUCCESS") {
      details.amountIn = deposited?.toString();
      const out = swap.flex && deposited !== undefined ? (deposited * BPS) / (BPS + swap.fees) : swap.amountOut;
      details.amountOut = out.toString();
      details.destinationChainTxHashes = [
        { hash: mockAddress("eth", `out:${swap.deposit?.txHash}`), explorerUrl: "" },
      ];
    }
    if (status === "REFUNDED") {
      details.refundedAmount = deposited?.toString();
      details.refundReason =
        deposited !== undefined && deposited < swap.minAmountIn ? "PARTIAL_DEPOSIT" : "MOCK_REFUND";
    }
    return {
      correlationId: `mock-${createHash("sha256").update(String(swap.quote.depositAddress)).digest("hex").slice(0, 12)}`,
      quoteResponse: envelope(swap.request, swap.quote),
      status,
      updatedAt: updatedAt.toISOString(),
      swapDetails: details,
    };
  }

  function progress(swap: Swap): { status: OneClickStatus; updatedAt: Date } {
    const now = options.now();
    if (!swap.deposit) return { status: "PENDING_DEPOSIT", updatedAt: now };
    if (swap.deposit.amount < swap.minAmountIn) {
      return now < swap.deadline
        ? { status: "INCOMPLETE_DEPOSIT", updatedAt: swap.deposit.at }
        : { status: "REFUNDED", updatedAt: swap.deadline };
    }
    const elapsed = now.getTime() - swap.deposit.at.getTime();
    const at = (ms: number) => new Date(swap.deposit!.at.getTime() + ms);
    if (elapsed < processingAfterMs) return { status: "KNOWN_DEPOSIT_TX", updatedAt: swap.deposit.at };
    if (elapsed < settleAfterMs || swap.outcome === "HELD") {
      return { status: "PROCESSING", updatedAt: at(processingAfterMs) };
    }
    return { status: swap.outcome, updatedAt: at(settleAfterMs) };
  }

  const routes: Record<string, (req: IncomingMessage, url: URL) => Promise<Reply> | Reply> = {
    "GET /v0/tokens": () => [200, tokens()],
    "GET /v0/status": (_, url) => status(url.searchParams.get("depositAddress") ?? ""),
    "POST /v0/quote": async (req) => quote(await jsonBody(req)),
    "POST /v0/deposit/submit": submit,
    "POST /mock/deposit": mockDeposit,
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://mock");
    const route = routes[`${req.method} ${url.pathname}`];
    let reply: Reply;
    try {
      reply = route ? await route(req, url) : [404, { message: "Not found" }];
    } catch {
      reply = [500, { message: "mock failure" }];
    }
    res.writeHead(reply[0], { "content-type": "application/json" });
    res.end(JSON.stringify(reply[1]));
  }

  async function submit(req: IncomingMessage): Promise<Reply> {
    const body = await jsonBody(req);
    if (typeof body.txHash !== "string" || typeof body.depositAddress !== "string") {
      return [400, { message: "txHash and depositAddress are required" }];
    }
    return recordDeposit(body.depositAddress, null, body.txHash);
  }

  // Not part of 1Click: lets a local run or a test deposit an exact amount, including an underpayment.
  async function mockDeposit(req: IncomingMessage): Promise<Reply> {
    const body = await jsonBody(req);
    if (
      typeof body.depositAddress !== "string" ||
      typeof body.amount !== "string" ||
      !/^\d+$/.test(body.amount)
    ) {
      return [400, { message: "depositAddress and an integer amount are required" }];
    }
    return recordDeposit(
      body.depositAddress,
      BigInt(body.amount),
      mockAddress("eth", `deposit:${body.depositAddress}`),
    );
  }

  return { handle };
}

function validateQuote(body: Record<string, unknown>, now: Date): string | null {
  const assets = new Set(
    Object.entries(CHAINS).flatMap(([chain, symbols]) => symbols.map((s) => mockAssetId(chain, s))),
  );
  const required = ["dry", "swapType", "slippageTolerance", "originAsset", "depositType", "destinationAsset"];
  for (const key of [
    ...required,
    "amount",
    "refundTo",
    "refundType",
    "recipient",
    "recipientType",
    "deadline",
  ]) {
    if (body[key] === undefined) return `${key} is required`;
  }
  if (!SWAP_TYPES.includes(String(body.swapType))) return "mock supports EXACT_INPUT, EXACT_OUTPUT and FLEX_INPUT only";
  if (!assets.has(String(body.originAsset)) || !assets.has(String(body.destinationAsset)))
    return "unknown asset";
  if (typeof body.amount !== "string" || !/^\d+$/.test(body.amount))
    return "amount must be an integer string";
  if (!Number.isInteger(body.slippageTolerance)) return "slippageTolerance must be whole basis points";
  const deadline = new Date(String(body.deadline));
  if (Number.isNaN(deadline.getTime()) || deadline <= now) return "deadline must be a future date";
  return null;
}

function outcomeFor(amount: bigint): Outcome {
  const suffix = amount % 100n;
  if (suffix === 1n) return "REFUNDED";
  if (suffix === 2n) return "FAILED";
  if (suffix === 3n) return "HELD";
  return "SUCCESS";
}

function envelope(request: Record<string, unknown>, quote: Record<string, unknown>): unknown {
  return {
    correlationId: "mock-quote",
    timestamp: new Date(0).toISOString(),
    signature: "mock-signature",
    quoteRequest: request,
    quote,
  };
}

function mockAddress(originAsset: string, seed: string): string {
  const hash = createHash("sha256").update(seed).digest("hex");
  return originAsset.includes(":near:") ? hash : `0x${hash.slice(0, 40)}`;
}

function formatUnits(units: bigint): string {
  const digits = units.toString().padStart(DECIMALS + 1, "0");
  return `${digits.slice(0, -DECIMALS)}.${digits.slice(-DECIMALS)}`;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

async function jsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
