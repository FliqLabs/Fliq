import { actions } from "near-api-js";
import { describe, expect, it } from "vitest";
import { checkPolicy, DelegateError, PolicyError, verifySignedDelegate, type RelayPolicy } from "./index";
import { newUser, PAYOUT_ARGS, signDelegate, TGAS, USDC, VAULT } from "./near.fixtures";

const policy: RelayPolicy = { vaultContractId: VAULT, usdcContractId: USDC };
const ada = newUser("ada.fliq.testnet");

async function verified(spec: Parameters<typeof signDelegate>[1] = {}) {
  return verifySignedDelegate((await signDelegate(ada, spec)).base64);
}

describe("verifySignedDelegate", () => {
  it("decodes a signed delegate and verifies the signature over the NEP-461 message", async () => {
    const delegate = await verified();
    expect(delegate).toMatchObject({
      senderId: "ada.fliq.testnet",
      receiverId: VAULT,
      nonce: 101n,
      maxBlockHeight: 5_100n,
      publicKey: ada.publicKey,
    });
    expect(delegate.calls).toEqual([
      { methodName: "payout", args: expect.any(Uint8Array), gas: 30n * TGAS, deposit: 0n },
    ]);
    expect(delegate.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives the same delegate the same hash", async () => {
    const { base64 } = await signDelegate(ada);
    expect(verifySignedDelegate(base64).hash).toBe(verifySignedDelegate(base64).hash);
  });

  it("rejects a delegate whose signature was made by another key", async () => {
    const { bytes } = await signDelegate(ada);
    const forged = Uint8Array.from(bytes);
    forged[forged.length - 1] = (forged.at(-1) ?? 0) ^ 0xff;
    expect(() => verifySignedDelegate(Buffer.from(forged).toString("base64"))).toThrow(
      expect.objectContaining({ code: "bad_signature" }),
    );
  });

  it("rejects a delegate whose content was changed after signing", async () => {
    const { bytes } = await signDelegate(ada, { args: { order_id: "po_1" } });
    const text = Buffer.from(bytes).toString("latin1").replace("po_1", "po_9");
    expect(() => verifySignedDelegate(Buffer.from(text, "latin1").toString("base64"))).toThrow(
      expect.objectContaining({ code: "bad_signature" }),
    );
  });

  it.each([
    ["not base64", "%%%"],
    ["empty", ""],
    ["garbage bytes", Buffer.from("not a delegate").toString("base64")],
    ["oversized", Buffer.alloc(17 * 1024, 1).toString("base64")],
  ])("rejects %s input as malformed", (_, input) => {
    expect(() => verifySignedDelegate(input)).toThrow(DelegateError);
  });

  it("rejects trailing bytes after the signed delegate", async () => {
    const { bytes } = await signDelegate(ada);
    const padded = Buffer.concat([Buffer.from(bytes), Buffer.from([0])]).toString("base64");
    expect(() => verifySignedDelegate(padded)).toThrow(expect.objectContaining({ code: "malformed" }));
  });

  it("refuses to relay anything but function calls", async () => {
    const { base64 } = await signDelegate(ada, { extraActions: [actions.transfer(10n ** 24n)] });
    expect(() => verifySignedDelegate(base64)).toThrow(
      expect.objectContaining({ code: "unsupported_action" }),
    );
  });
});

describe("checkPolicy", () => {
  it.each([
    ["a vault payout", { methodName: "payout", args: PAYOUT_ARGS }],
    [
      "a vault payout with a numeric amount",
      { methodName: "payout", args: { ...PAYOUT_ARGS, amount: 50_000_000 } },
    ],
    ["a vault order release", { methodName: "release_order", args: { order_id: "po_1" } }],
    [
      "an agent policy",
      {
        methodName: "set_agent",
        args: {
          agent_id: "agent-1.ada.testnet",
          per_payout_cap: "50000000",
          daily_cap: "100000000",
          corridors: ["NG-NGN-bank"],
        },
      },
    ],
    [
      "an agent policy for any corridor",
      {
        methodName: "set_agent",
        args: { agent_id: "agent-1.ada.testnet", per_payout_cap: "1", daily_cap: "1", corridors: null },
      },
    ],
    ["an agent removal", { methodName: "remove_agent", args: { agent_id: "agent-1.ada.testnet" } }],
    [
      "a USDC top-up into the vault",
      {
        receiverId: USDC,
        methodName: "ft_transfer_call",
        deposit: 1n,
        args: { receiver_id: VAULT, amount: "5000000", msg: "" },
      },
    ],
  ])("allows %s", async (_, spec) => {
    const delegate = verifySignedDelegate((await signDelegate(ada, spec)).base64);
    expect(() => checkPolicy(policy, delegate)).not.toThrow();
  });

  it.each([
    ["an unknown receiver", { receiverId: "evil.testnet" }],
    ["a receiver named like an Object member", { receiverId: "constructor" }],
    ["an unlisted vault method", { methodName: "recredit" }],
    ["a method named like an Object member", { methodName: "__proto__" }],
    ["a deposit on payout", { deposit: 1n }],
    ["more than 100 Tgas", { gas: 101n * TGAS }],
    ["zero gas", { gas: 0n }],
    ["extra arguments", { args: { ...PAYOUT_ARGS, memo: "x" } }],
    ["a payout without amount or destination", { args: { order_id: "po_1" } }],
    ["a missing order id", { args: { amount: "1", deposit_address: "pay.paycrest.testnet" } }],
    ["a numeric order id", { args: { ...PAYOUT_ARGS, order_id: 7 } }],
    ["an over-long order id", { args: { ...PAYOUT_ARGS, order_id: "x".repeat(65) } }],
    ["a zero amount", { args: { ...PAYOUT_ARGS, amount: "0" } }],
    ["a fractional amount", { args: { ...PAYOUT_ARGS, amount: 1.5 } }],
    ["an unsafe numeric amount", { args: { ...PAYOUT_ARGS, amount: 2 ** 60 } }],
    [
      "a destination that is not an account id",
      { args: { ...PAYOUT_ARGS, deposit_address: "Not An Account" } },
    ],
    [
      "an agent with a zero cap",
      {
        methodName: "set_agent",
        args: { agent_id: "agent-1.ada.testnet", per_payout_cap: "0", daily_cap: "1", corridors: null },
      },
    ],
    [
      "an agent without corridors",
      {
        methodName: "set_agent",
        args: { agent_id: "agent-1.ada.testnet", per_payout_cap: "1", daily_cap: "1" },
      },
    ],
    [
      "an agent with an empty corridor list",
      {
        methodName: "set_agent",
        args: { agent_id: "agent-1.ada.testnet", per_payout_cap: "1", daily_cap: "1", corridors: [] },
      },
    ],
    ["an agent id that is not an account", { methodName: "remove_agent", args: { agent_id: "Agent One" } }],
    [
      "USDC sent anywhere but the vault",
      {
        receiverId: USDC,
        methodName: "ft_transfer_call",
        deposit: 1n,
        args: { receiver_id: "evil.testnet", amount: "1", msg: "" },
      },
    ],
    [
      "a top-up message naming another account",
      {
        receiverId: USDC,
        methodName: "ft_transfer_call",
        deposit: 1n,
        args: { receiver_id: VAULT, amount: "1", msg: '{"top_up":{"account_id":"bob.testnet"}}' },
      },
    ],
    [
      "a zero top-up",
      {
        receiverId: USDC,
        methodName: "ft_transfer_call",
        deposit: 1n,
        args: { receiver_id: VAULT, amount: "0", msg: "" },
      },
    ],
    [
      "a top-up without the one yocto",
      {
        receiverId: USDC,
        methodName: "ft_transfer_call",
        args: { receiver_id: VAULT, amount: "1", msg: "" },
      },
    ],
    [
      "storage registration paid by the user",
      {
        receiverId: USDC,
        methodName: "storage_deposit",
        deposit: 1_250_000_000_000_000_000_000n,
        args: { account_id: "ada.fliq.testnet" },
      },
    ],
  ])("refuses %s", async (_, spec) => {
    const delegate = verifySignedDelegate(
      (await signDelegate(ada, spec as Parameters<typeof signDelegate>[1])).base64,
    );
    expect(() => checkPolicy(policy, delegate)).toThrow(PolicyError);
  });

  it("refuses two calls in one delegate", async () => {
    const delegate = await verified();
    delegate.calls.push({ ...delegate.calls[0]! });
    expect(() => checkPolicy(policy, delegate)).toThrow("exactly one call");
  });

  it("refuses arguments that are not a JSON object", async () => {
    const delegate = await verified();
    delegate.calls[0]!.args = new Uint8Array(Buffer.from("[1,2]"));
    expect(() => checkPolicy(policy, delegate)).toThrow("JSON object");
  });
});
