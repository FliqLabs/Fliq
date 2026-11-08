import { agentKeyFrom, PAYOUT_GAS, publicKeyText, signDelegate, type AgentKey } from "./delegate.js";

export interface AgentConfig {
  accountId: string;
  secretKey: string;
  nearRpcUrl: string;
  vaultContractId: string;
}

export interface VaultOrder {
  orderId: string;
  amountUnits: bigint;
  depositAddress: string;
}

export interface VaultAgent {
  accountId: string;
  signPayout: (order: VaultOrder) => Promise<{ signedDelegate: string; hash: string }>;
}

// The relayer refuses a delegate more than 1,200 blocks ahead; 120 blocks is about two minutes.
const VALIDITY_BLOCKS = 120n;

export async function createVaultAgent(
  config: AgentConfig,
  fetcher: typeof fetch = fetch,
): Promise<VaultAgent> {
  const key = await agentKeyFrom(config.accountId, config.secretKey);
  return {
    accountId: config.accountId,
    signPayout: async (order) => {
      const access = await viewAccessKey(fetcher, config.nearRpcUrl, key);
      return signDelegate(key, {
        call: {
          receiverId: config.vaultContractId,
          methodName: "payout",
          args: {
            order_id: order.orderId,
            amount: order.amountUnits.toString(),
            deposit_address: order.depositAddress,
          },
          gas: PAYOUT_GAS,
          deposit: 0n,
        },
        nonce: access.nonce + 1n,
        maxBlockHeight: access.blockHeight + VALIDITY_BLOCKS,
      });
    },
  };
}

async function viewAccessKey(fetcher: typeof fetch, rpcUrl: string, key: AgentKey) {
  const response = await fetcher(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "fliq-mcp",
      method: "query",
      params: {
        request_type: "view_access_key",
        finality: "final",
        account_id: key.accountId,
        public_key: publicKeyText(key.publicKey),
      },
    }),
  });
  const body = (await response.json().catch(() => null)) as {
    result?: { nonce?: number | string; block_height?: number | string; error?: string };
  } | null;
  const result = body?.result;
  if (
    !response.ok ||
    !result ||
    result.error ||
    result.nonce === undefined ||
    result.block_height === undefined
  ) {
    throw new Error("The agent key is not on the agent account, or the NEAR RPC did not answer.");
  }
  return { nonce: BigInt(result.nonce), blockHeight: BigInt(result.block_height) };
}
