import { KeyPair } from "near-api-js";
import { beforeEach, describe, expect, it } from "vitest";
import { AccountError, AGENT_DEPOSIT_FLOOR, fundAgentDeposit, MemoryRelayStore, NearRpcError, provisionAccount, type ProvisionDeps } from "./index";
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

  it("skips storage registration for an account that never holds a balance, such as an agent's", async () => {
    const agent = newUser("claude-ada.fliq.testnet");
    const result = await provisionAccount(deps, agent.accountId, agent.publicKey, { registerStorage: false });
    expect(result).toMatchObject({ status: "created", storage: {} });
    expect(rpc.sent.map((tx) => tx.actionKinds)).toEqual([["createAccount", "addKey"]]);
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

describe("fundAgentDeposit", () => {
  const owner = "ada.fliq.testnet";
  const agent = "claude-ada.fliq.testnet";
  // storageUsage 200 locks 2e21 yocto, so 1e21 on top leaves nothing free for the deposit.
  const locked = 200n * 10n ** 19n;

  beforeEach(() => {
    rpc.addAccount(owner);
    rpc.addAccount(agent);
    rpc.setAmount(owner, locked + 1n);
  });

  it("tops a fresh owner up to the floor from the root, once per agent", async () => {
    const first = await fundAgentDeposit(deps, owner, agent);
    expect(first).toMatchObject({ status: "funded", accountId: owner, agentId: agent, yocto: (AGENT_DEPOSIT_FLOOR - 1n).toString() });
    expect(rpc.sent).toHaveLength(1);
    expect(rpc.sent[0]).toMatchObject({ signerId: ROOT, receiverId: owner, actionKinds: ["transfer"] });
    expect(rpc.sent[0]!.raw.transaction.actions[0]!.transfer!.deposit).toBe(AGENT_DEPOSIT_FLOOR - 1n);

    rpc.setAmount(owner, locked);
    expect(await fundAgentDeposit(deps, owner, agent)).toMatchObject({ status: "already_funded", yocto: "0" });
    expect(rpc.sent).toHaveLength(1);
  });

  it("sends nothing to an owner who already holds the floor", async () => {
    rpc.setAmount(owner, locked + AGENT_DEPOSIT_FLOOR);
    expect(await fundAgentDeposit(deps, owner, agent)).toMatchObject({ status: "not_needed", yocto: "0" });
    expect(rpc.sent).toHaveLength(0);
  });

  it("funds each new agent separately, and only up to the floor", async () => {
    const second = "travel-ada.fliq.testnet";
    rpc.addAccount(second);
    await fundAgentDeposit(deps, owner, agent);
    rpc.setAmount(owner, locked + AGENT_DEPOSIT_FLOOR / 2n);
    expect(await fundAgentDeposit(deps, owner, second)).toMatchObject({ status: "funded", yocto: (AGENT_DEPOSIT_FLOOR / 2n).toString() });
  });

  it("refuses accounts outside the root, an agent that is not created yet, and paying the agent itself", async () => {
    expect(await code(fundAgentDeposit(deps, "ada.near", agent))).toBe("invalid_name");
    expect(await code(fundAgentDeposit(deps, owner, "ghost-ada.fliq.testnet"))).toBe("invalid_name");
    expect(await code(fundAgentDeposit(deps, owner, owner))).toBe("invalid_name");
    expect(rpc.sent).toHaveLength(0);
  });

  it("lets a retry fund the agent when the first transfer failed", async () => {
    rpc.behaviour = (tx) => ({ txHash: tx.txHash, status: "failed", failures: ["boom"], gasBurnt: 1n });
    expect(await code(fundAgentDeposit(deps, owner, agent))).toBe("chain_failure");
    rpc.behaviour = (tx) => ({ txHash: tx.txHash, status: "succeeded", failures: [], gasBurnt: 1n });
    expect((await fundAgentDeposit(deps, owner, agent)).status).toBe("funded");
  });
});
