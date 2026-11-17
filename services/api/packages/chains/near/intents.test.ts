import { describe, expect, it } from "vitest";
import { intentsBalances, NearRpcError } from "./index";

const SOL_USDC = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";

function viewing(answers: Record<string, unknown>) {
  const calls: { contractId: string; method: string; args: unknown }[] = [];
  const rpc = {
    callView: async (contractId: string, method: string, args: unknown) => {
      calls.push({ contractId, method, args });
      return answers[method];
    },
  };
  return { rpc, calls };
}

describe("intentsBalances", () => {
  it("reads every token an account holds on intents.near and keeps the ones above zero", async () => {
    const { rpc, calls } = viewing({
      mt_tokens_for_owner: [{ token_id: SOL_USDC }, { token_id: BASE_USDC }],
      mt_batch_balance_of: ["1632606", "0"],
    });
    expect(await intentsBalances(rpc, "faiz.fliqaccount.near")).toEqual([
      { tokenId: SOL_USDC, units: 1_632_606n },
    ]);
    expect(calls).toEqual([
      {
        contractId: "intents.near",
        method: "mt_tokens_for_owner",
        args: { account_id: "faiz.fliqaccount.near", from_index: "0", limit: 100 },
      },
      {
        contractId: "intents.near",
        method: "mt_batch_balance_of",
        args: { account_id: "faiz.fliqaccount.near", token_ids: [SOL_USDC, BASE_USDC] },
      },
    ]);
  });

  it("asks for no balances when the account holds nothing", async () => {
    const { rpc, calls } = viewing({ mt_tokens_for_owner: [] });
    expect(await intentsBalances(rpc, "ada.near", "intents.example.near")).toEqual([]);
    expect(calls.map((call) => call.method)).toEqual(["mt_tokens_for_owner"]);
  });

  it.each([
    ["a token list that is not a list", { mt_tokens_for_owner: null }],
    [
      "a balance count that does not match",
      { mt_tokens_for_owner: [{ token_id: SOL_USDC }], mt_batch_balance_of: [] },
    ],
    [
      "a balance that is not an integer string",
      { mt_tokens_for_owner: [{ token_id: SOL_USDC }], mt_batch_balance_of: [1.5] },
    ],
  ])("refuses %s", async (_, answers) => {
    await expect(intentsBalances(viewing(answers).rpc, "ada.near")).rejects.toThrow(NearRpcError);
  });
});
