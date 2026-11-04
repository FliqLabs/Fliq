import { KeyPair } from "near-api-js";
import { beforeEach, describe, expect, it } from "vitest";
import { AccountError, MemoryRelayStore, NearRpcError, provisionAccount, type ProvisionDeps } from "./index";
import { FakeNearRpc, newUser, publicKeyText, ROOT, USDC, VAULT } from "./near.fixtures";

let rpc: FakeNearRpc;
let deps: ProvisionDeps;
const rootKey = KeyPair.fromRandom("ed25519");

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (error: AccountError) => error.code ?? error.name,
  );

beforeEach(() => {
  rpc = new FakeNearRpc();
  rpc.addKey(ROOT, rootKey.getPublicKey().toString(), { nonce: 40n, permission: "FullAccess" });
  rpc.addAccount(USDC, true);
  deps = {
    rpc,
    store: new MemoryRelayStore(),
    root: { accountId: ROOT, privateKey: rootKey.toString() },
    fundingYocto: 0n,
    storageContracts: [USDC, VAULT],
  };
});

describe("provisionAccount", () => {
  it("creates <label>.<root> owned only by the user's key and registers its USDC storage", async () => {
    const ada = newUser("ada.fliq.testnet");
    const result = await provisionAccount(deps, ada.accountId, ada.publicKey);
    expect(result).toEqual({
      status: "created",
      accountId: ada.accountId,
      publicKey: ada.publicKey,
      txHashes: [rpc.sent[0]!.txHash, rpc.sent[1]!.txHash],
      storage: { [USDC]: "registered", [VAULT]: "not_deployed" },
    });
    const [create, storage] = rpc.sent;
    expect(create).toMatchObject({
      signerId: ROOT,
      receiverId: ada.accountId,
      nonce: 41n,
      actionKinds: ["createAccount", "addKey"],
    });
    expect(publicKeyText(create!.raw.transaction.actions[1]!.addKey!.publicKey)).toBe(ada.publicKey);
    expect(create!.raw.transaction.actions[1]!.addKey!.accessKey.permission.fullAccess).toBeDefined();
    expect(storage).toMatchObject({
      signerId: ROOT,
      receiverId: USDC,
      nonce: 42n,
      actionKinds: ["functionCall"],
    });
    const call = storage!.raw.transaction.actions[0]!.functionCall!;
    expect(call.methodName).toBe("storage_deposit");
    expect(call.deposit).toBe(1_250_000_000_000_000_000_000n);
    expect(JSON.parse(Buffer.from(call.args).toString())).toEqual({
      account_id: ada.accountId,
      registration_only: true,
    });
  });

  it("funds the new account when configured", async () => {
    deps.fundingYocto = 10n ** 21n;
    const ada = newUser("ada.fliq.testnet");
    await provisionAccount(deps, ada.accountId, ada.publicKey);
    expect(rpc.sent[0]!.actionKinds).toEqual(["createAccount", "transfer", "addKey"]);
    expect(rpc.sent[0]!.raw.transaction.actions[1]!.transfer!.deposit).toBe(10n ** 21n);
  });

  it("links an account the user's key already controls, paying for nothing already done", async () => {
    const ada = newUser("ada.fliq.testnet");
    rpc.addKey(ada.accountId, ada.publicKey);
    rpc.registerStorage(USDC, ada.accountId);
    expect(await provisionAccount(deps, ada.accountId, ada.publicKey)).toMatchObject({
      status: "linked",
      txHashes: [],
      storage: { [USDC]: "already_registered", [VAULT]: "not_deployed" },
    });
    expect(rpc.sent).toEqual([]);
  });

  it("refuses a name that exists under someone else's key", async () => {
    const squatter = newUser("ada.fliq.testnet");
    rpc.addKey(squatter.accountId, squatter.publicKey);
    const ada = newUser("ada.fliq.testnet");
    expect(await code(provisionAccount(deps, ada.accountId, ada.publicKey))).toBe("taken");
    expect(rpc.sent).toEqual([]);
  });

  it.each([
    ["another root", "ada.other.testnet"],
    ["a nested label", "a.b.fliq.testnet"],
    ["upper case", "Ada.fliq.testnet"],
    ["a leading hyphen", "-ada.fliq.testnet"],
    ["the root itself", "fliq.testnet"],
    ["an over-long name", `${"a".repeat(60)}.fliq.testnet`],
  ])("refuses %s", async (_, accountId) => {
    expect(await code(provisionAccount(deps, accountId, newUser(accountId).publicKey))).toBe("invalid_name");
  });

  it("refuses keys that are not ed25519 public keys", async () => {
    const secp = KeyPair.fromRandom("secp256k1").getPublicKey().toString();
    expect(await code(provisionAccount(deps, "ada.fliq.testnet", secp))).toBe("invalid_key");
    expect(await code(provisionAccount(deps, "ada.fliq.testnet", "ed25519:notakey"))).toBe("invalid_key");
  });

  it("reports pending on an unknown outcome and finishes on retry without creating twice", async () => {
    const ada = newUser("ada.fliq.testnet");
    let first = true;
    rpc.behaviour = (tx) => {
      if (first) {
        first = false;
        rpc.addKey(ada.accountId, ada.publicKey);
        throw new NearRpcError("send_tx", "timeout", "no response in time");
      }
      return { txHash: tx.txHash, status: "succeeded", failures: [], gasBurnt: 1n };
    };
    const pending = await provisionAccount(deps, ada.accountId, ada.publicKey);
    expect(pending).toMatchObject({ status: "pending", txHashes: [rpc.sent[0]!.txHash], storage: {} });
    const done = await provisionAccount(deps, ada.accountId, ada.publicKey);
    expect(done).toMatchObject({ status: "linked", storage: { [USDC]: "registered" } });
    expect(rpc.sent.filter((tx) => tx.actionKinds.includes("createAccount"))).toHaveLength(1);
  });

  it("surfaces a failed creation instead of reporting success", async () => {
    rpc.behaviour = (tx) => ({
      txHash: tx.txHash,
      status: "failed",
      failures: ['{"AccountAlreadyExists":{}}'],
      gasBurnt: 1n,
    });
    const ada = newUser("ada.fliq.testnet");
    expect(await code(provisionAccount(deps, ada.accountId, ada.publicKey))).toBe("chain_failure");
  });

  it("serialises concurrent requests for the same name", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    rpc.behaviour = async (tx) => {
      await gate;
      return { txHash: tx.txHash, status: "succeeded", failures: [], gasBurnt: 1n };
    };
    const ada = newUser("ada.fliq.testnet");
    const firstRun = provisionAccount(deps, ada.accountId, ada.publicKey);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await code(provisionAccount(deps, ada.accountId, ada.publicKey))).toBe("in_progress");
    release();
    expect((await firstRun).status).toBe("created");
  });
});
