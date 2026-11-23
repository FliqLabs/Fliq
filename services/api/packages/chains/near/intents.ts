import { NearRpcError, type NearRpc } from "./rpc";

export const INTENTS_CONTRACT = "intents.near";
const PAGE = 100;
const MAX_PAGES = 5;

export type IntentsBalance = { tokenId: string; units: bigint };

// What an account holds on the NEAR Intents contract (NEP-245), where 1Click refunds a swap it could not finish.
export async function intentsBalances(
  rpc: Pick<NearRpc, "callView">,
  accountId: string,
  contractId = INTENTS_CONTRACT,
): Promise<IntentsBalance[]> {
  const tokenIds: string[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const tokens = await rpc.callView(contractId, "mt_tokens_for_owner", {
      account_id: accountId,
      from_index: String(page * PAGE),
      limit: PAGE,
    });
    if (!Array.isArray(tokens)) throw invalid("mt_tokens_for_owner did not return a list");
    for (const token of tokens) {
      const id = (token as { token_id?: unknown } | null)?.token_id;
      if (typeof id !== "string" || id === "") throw invalid("a token has no token_id");
      tokenIds.push(id);
    }
    if (tokens.length < PAGE) break;
  }
  if (tokenIds.length === 0) return [];
  const balances = await rpc.callView(contractId, "mt_batch_balance_of", {
    account_id: accountId,
    token_ids: tokenIds,
  });
  if (!Array.isArray(balances) || balances.length !== tokenIds.length)
    throw invalid("mt_batch_balance_of did not return one balance per token");
  return tokenIds.flatMap((tokenId, index) => {
    const units = balances[index];
    if (typeof units !== "string" || !/^\d+$/.test(units))
      throw invalid("a balance is not an integer string");
    return BigInt(units) > 0n ? [{ tokenId, units: BigInt(units) }] : [];
  });
}

const invalid = (detail: string) => new NearRpcError("call_function", "invalid_response", detail);
