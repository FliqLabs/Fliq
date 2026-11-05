import { createOneClickClient, type OneClickClient, type QuoteInput } from "./index";

// Responses below follow the schemas in the 1Click OpenAPI document 0.1.10. They are modelled, not captured live.
export const API_KEY = "test-api-key-value";
export const DEPOSIT = "0x76b4c56085ed136a8744d52be956396624a730e8";

export type Handler = (request: Request) => Response | Promise<Response>;

export function fakeFetch(...handlers: Handler[]) {
  const requests: Request[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    const handler = handlers[Math.min(requests.length - 1, handlers.length - 1)]!;
    return handler(request);
  };
  return { fetch: fetchImpl as typeof fetch, requests };
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
export const hang: Handler = (request) =>
  new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(request.signal.reason)));

export function testClient(fetchImpl: typeof fetch, { withKey = true } = {}): OneClickClient {
  return createOneClickClient({
    baseUrl: "https://1click.example.com/",
    apiKey: withKey ? API_KEY : undefined,
    fetch: fetchImpl,
    sleep: async () => {},
  });
}

export const quoteInput: QuoteInput = {
  dry: false,
  swapType: "EXACT_OUTPUT",
  slippageBps: 50,
  originAsset: "nep141:sol-usdc.omft.near",
  destinationAsset: "nep141:base-usdc.omft.near",
  amount: 50_000_000n,
  refundTo: "SenderSolanaAddress111111111111111111111111",
  recipient: DEPOSIT,
  deadline: new Date("2026-11-05T12:30:00.000Z"),
  appFees: [{ recipient: "fees.fliq.near", feeBps: 30 }],
};

export const quoteResponse = {
  correlationId: "c-1",
  timestamp: "2026-11-05T12:00:00.000Z",
  signature: "sig",
  quoteRequest: {},
  quote: {
    depositAddress: "SolDeposit1111111111111111111111111111111111",
    amountIn: "50300000",
    amountInFormatted: "50.3",
    amountInUsd: "50.3",
    minAmountIn: "50050000",
    amountOut: "50000000",
    amountOutFormatted: "50",
    amountOutUsd: "50",
    minAmountOut: "50000000",
    deadline: "2026-11-05T12:30:00.000Z",
    timeWhenInactive: "2026-11-05T12:25:00.000Z",
    timeEstimate: 35,
  },
};

export const execution = (status: string, swapDetails: Record<string, unknown> = {}) => ({
  correlationId: "c-2",
  quoteResponse: quoteResponse,
  status,
  updatedAt: "2026-11-05T12:01:00.000Z",
  swapDetails: {
    intentHashes: [],
    nearTxHashes: [],
    originChainTxHashes: [],
    destinationChainTxHashes: [],
    ...swapDetails,
  },
});
