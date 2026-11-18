import { actions } from "near-api-js";
import { describe, expect, it } from "vitest";
import { checkPolicy, DelegateError, PolicyError, verifySignedDelegate, type RelayPolicy } from "./index";
import { newUser, PAYOUT_ARGS, signDelegate, signKeyChange, TGAS, USDC, VAULT } from "./near.fixtures";

const policy: RelayPolicy = { vaultContractId: VAULT, usdcContractId: USDC, intentsContractId: "intents.near" };
const ada = newUser("ada.fliq.testnet");
const MT_TRANSFER_ARGS = {
  receiver_id: "3f1c9a7e5b2d4f6081a3c5e7f9b1d3a5c7e9f1b3d5a7c9e1f3b5d7a9c1e3f5b7",
  token_id: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
  amount: "1632606",
};

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
      { methodName: "payout", args: expect.any(Uint8Array), gas: 80n * TGAS, deposit: 0n },
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

describe("a key change", () => {
  const other = newUser("other.fliq.testnet").publicKey;

  it("is read as adding a full-access key, with no calls", async () => {
    const delegate = verifySignedDelegate((await signKeyChange(ada, { add: other })).base64);
    expect(delegate.keyChange).toEqual({ kind: "add_full_access", publicKey: other });
    expect(delegate.calls).toEqual([]);
    expect(delegate.receiverId).toBe(ada.accountId);
  });

  it("is read as removing a key", async () => {
    const delegate = verifySignedDelegate((await signKeyChange(ada, { remove: other })).base64);
    expect(delegate.keyChange).toEqual({ kind: "delete", publicKey: other });
  });

  it("is allowed on the signer's own account", async () => {
    for (const change of [{ add: other }, { remove: other }]) {
      const delegate = verifySignedDelegate((await signKeyChange(ada, change)).base64);
      expect(() => checkPolicy(policy, delegate)).not.toThrow();
    }
  });

  it("is refused on any other account, the vault included", async () => {
    for (const receiverId of ["tobi.fliq.testnet", VAULT, USDC]) {
      const delegate = verifySignedDelegate((await signKeyChange(ada, { add: other, receiverId })).base64);
      expect(() => checkPolicy(policy, delegate)).toThrow(PolicyError);
    }
  });

  it("cannot add or remove the key that signed it", async () => {
    for (const change of [{ add: ada.publicKey }, { remove: ada.publicKey }]) {
      const delegate = verifySignedDelegate((await signKeyChange(ada, change)).base64);
      expect(() => checkPolicy(policy, delegate)).toThrow(PolicyError);
    }
  });

  it("cannot add a function-call key", async () => {
    const { base64 } = await signKeyChange(ada, { add: other, functionCallOnly: true });
    expect(() => verifySignedDelegate(base64)).toThrow(expect.objectContaining({ code: "unsupported_action" }));
  });
});

const STORAGE = 5_000_000_000_000_000_000_000n;
const AGENT = (over: Record<string, unknown>) => ({
  public_key: "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp",
  agent_id: "agent-1.ada.testnet",
  cooldown_ns: "0",
  expiry_ns: "3600000000000",
  ...over,
});

describe("checkPolicy", () => {
  it.each([
    ["without its one yoctoNEAR", { methodName: "transfer", deposit: 0n, args: { to_account: "tobi.fliq.testnet", amount: "1" } }],
    ["with an extra argument", { methodName: "transfer", deposit: 1n, args: { to_account: "tobi.fliq.testnet", amount: "1", memo: "x" } }],
    ["of nothing", { methodName: "transfer", deposit: 1n, args: { to_account: "tobi.fliq.testnet", amount: "0" } }],
    ["as a withdraw without its one yoctoNEAR", { methodName: "withdraw", deposit: 0n, args: { amount: "1" } }],
    ["as a withdraw to someone else", { methodName: "withdraw", deposit: 1n, args: { amount: "1", receiver_id: "mallory.testnet" } }],
  ])("refuses a transfer %s", async (_, spec) => {
    const delegate = verifySignedDelegate((await signDelegate(ada, spec)).base64);
    expect(() => checkPolicy(policy, delegate)).toThrow(PolicyError);
  });

  it.each([
    ["a vault payout", { methodName: "payout", args: PAYOUT_ARGS }],
    [
      "a vault payout with a numeric amount",
      { methodName: "payout", args: { ...PAYOUT_ARGS, amount: 50_000_000 } },
    ],
    ["a vault order release", { methodName: "release_order", args: { order_id: "po_1" } }],
    ["a withdraw to the user's own account", { methodName: "withdraw", deposit: 1n, args: { amount: "1000000" } }],
    [
      "an agent policy",
      {
        methodName: "set_agent",
        deposit: STORAGE,
        args: AGENT({ per_payout_cap: "50000000", daily_cap: "100000000", corridors: ["NG-NGN-bank"] }),
      },
    ],
    [
      "an agent policy for any corridor",
      { methodName: "set_agent", deposit: 1n, args: AGENT({ per_payout_cap: "1", daily_cap: "1", corridors: null }) },
    ],
    [
      "an agent policy that leaves corridors out",
      { methodName: "set_agent", deposit: 1n, args: AGENT({ per_payout_cap: "1", daily_cap: "1" }) },
    ],
    ["an agent removal", { methodName: "remove_agent", deposit: 1n, args: { agent_id: "agent-1.ada.testnet" } }],
    [
      "a transfer to another fliq user",
      { methodName: "transfer", deposit: 1n, args: { to_account: "tobi.fliq.testnet", amount: "25000000" } },
    ],
    [
      "a USDC top-up into the vault",
      {
        receiverId: USDC,
        methodName: "ft_transfer_call",
        deposit: 1n,
        args: { receiver_id: VAULT, amount: "5000000", msg: "" },
      },
    ],
    [
      "USDC sent to a NEAR wallet outside fliq",
      { receiverId: USDC, methodName: "ft_transfer", deposit: 1n, args: { receiver_id: "rejois.near", amount: "300000", memo: "fliq" } },
    ],
    [
      "registering a NEAR wallet for USDC before a send",
      {
        receiverId: USDC,
        methodName: "storage_deposit",
        deposit: 1_250_000_000_000_000_000_000n,
        args: { account_id: "rejois.near", registration_only: true },
      },
    ],
    [
      "a 1Click refund on NEAR Intents sent to a quote's deposit address",
      { receiverId: "intents.near", methodName: "mt_transfer", deposit: 1n, args: MT_TRANSFER_ARGS },
    ],
    [
      "the same with a memo",
      { receiverId: "intents.near", methodName: "mt_transfer", deposit: 1n, args: { ...MT_TRANSFER_ARGS, memo: "fliq refund" } },
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
    ["a payout with less than 50 Tgas", { gas: 49n * TGAS }],
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
      { methodName: "set_agent", deposit: 1n, args: AGENT({ per_payout_cap: "0", daily_cap: "1", corridors: null }) },
    ],
    [
      "an agent whose per-payout cap is above its daily cap",
      { methodName: "set_agent", deposit: 1n, args: AGENT({ per_payout_cap: "2", daily_cap: "1" }) },
    ],
    [
      "an agent with an empty corridor list",
      { methodName: "set_agent", deposit: 1n, args: AGENT({ per_payout_cap: "1", daily_cap: "1", corridors: [] }) },
    ],
    [
      "an agent without its key",
      { methodName: "set_agent", deposit: 1n, args: { ...AGENT({ per_payout_cap: "1", daily_cap: "1" }), public_key: undefined } },
    ],
    [
      "an agent with a negative expiry",
      { methodName: "set_agent", deposit: 1n, args: AGENT({ per_payout_cap: "1", daily_cap: "1", expiry_ns: "-1" }) },
    ],
    [
      "an agent policy with no deposit, which the vault refuses",
      { methodName: "set_agent", args: AGENT({ per_payout_cap: "1", daily_cap: "1" }) },
    ],
    [
      "an agent policy attaching more than its storage could cost",
      { methodName: "set_agent", deposit: 10n ** 22n + 1n, args: AGENT({ per_payout_cap: "1", daily_cap: "1" }) },
    ],
    ["an agent removal without the one yocto", { methodName: "remove_agent", args: { agent_id: "agent-1.ada.testnet" } }],
    ["an agent id that is not an account", { methodName: "remove_agent", deposit: 1n, args: { agent_id: "Agent One" } }],
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
      "a plain USDC transfer into the vault, which would not credit anyone",
      { receiverId: USDC, methodName: "ft_transfer", deposit: 1n, args: { receiver_id: VAULT, amount: "1" } },
    ],
    [
      "a USDC send without the one yocto",
      { receiverId: USDC, methodName: "ft_transfer", args: { receiver_id: "rejois.near", amount: "1" } },
    ],
    [
      "a registration that attaches more than USDC asks",
      {
        receiverId: USDC,
        methodName: "storage_deposit",
        deposit: 3_000_000_000_000_000_000_000n,
        args: { account_id: "rejois.near", registration_only: true },
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
    [
      "an Intents transfer to a named account instead of a deposit address",
      { receiverId: "intents.near", methodName: "mt_transfer", deposit: 1n, args: { ...MT_TRANSFER_ARGS, receiver_id: "evil.near" } },
    ],
    [
      "an Intents transfer to an upper-case hex address",
      { receiverId: "intents.near", methodName: "mt_transfer", deposit: 1n, args: { ...MT_TRANSFER_ARGS, receiver_id: "AB".repeat(32) } },
    ],
    [
      "another Intents method",
      { receiverId: "intents.near", methodName: "mt_transfer_call", deposit: 1n, args: { ...MT_TRANSFER_ARGS, msg: "" } },
    ],
    [
      "an Intents transfer without the one yocto",
      { receiverId: "intents.near", methodName: "mt_transfer", deposit: 0n, args: MT_TRANSFER_ARGS },
    ],
    [
      "an Intents transfer with an extra argument",
      { receiverId: "intents.near", methodName: "mt_transfer", deposit: 1n, args: { ...MT_TRANSFER_ARGS, approval: null } },
    ],
    [
      "an Intents transfer of a token that is not nep141",
      { receiverId: "intents.near", methodName: "mt_transfer", deposit: 1n, args: { ...MT_TRANSFER_ARGS, token_id: "nep245:v2_1.omni.hot.tg:1" } },
    ],
    [
      "an Intents transfer of nothing",
      { receiverId: "intents.near", methodName: "mt_transfer", deposit: 1n, args: { ...MT_TRANSFER_ARGS, amount: "0" } },
    ],
    [
      "an Intents transfer with more than 100 Tgas",
      { receiverId: "intents.near", methodName: "mt_transfer", deposit: 1n, gas: 101n * TGAS, args: MT_TRANSFER_ARGS },
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
