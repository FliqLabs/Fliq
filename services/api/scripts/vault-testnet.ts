import {
  createNearRpc,
  functionCallActions,
  publicKeyOf,
  signTransaction,
  TokenStorage,
  type NearRpc,
  type SigningKey,
} from "../packages/chains/near/index.js";
import { NearVault, VaultError } from "../packages/chains/vault/index.js";

// A full run against the deployed testnet vault: top up, register, pay out, report statuses, then register and
// release a second order. The payer pays itself, so the test USDC comes back and the run can be repeated.

const need = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const rpc = createNearRpc({ url: need("NEAR_RPC_URL") });
const vaultId = need("VAULT_CONTRACT_ID");
const usdc = need("USDC_CONTRACT_ID");
const payer: SigningKey = { accountId: need("NEAR_ROOT_ACCOUNT"), privateKey: need("NEAR_ROOT_PRIVATE_KEY") };
const depositAddress = process.env.VAULT_TEST_DEPOSIT_ADDRESS?.trim() || payer.accountId;
const units = BigInt(process.env.VAULT_TEST_UNITS ?? "100000");
const vault = new NearVault({
  rpc,
  contractId: vaultId,
  registration: { accountId: need("NEAR_REGISTRATION_ACCOUNT_ID"), privateKey: need("NEAR_REGISTRATION_PRIVATE_KEY") },
});

const steps: { step: string; tx?: string; result?: unknown }[] = [];
const record = (step: string, detail: { tx?: string; result?: unknown } = {}) => {
  steps.push({ step, ...detail });
  console.log(JSON.stringify({ step, ...detail }, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
};

async function send(signer: SigningKey, receiverId: string, method: string, args: object, gasTgas: bigint, deposit = 0n) {
  const [key, block] = await Promise.all([rpc.accessKey(signer.accountId, publicKeyOf(signer.privateKey)), rpc.finalBlock()]);
  if (!key) throw new Error(`no access key for ${signer.accountId}`);
  const tx = await signTransaction({
    signer,
    receiverId,
    nonce: key.nonce + 1n,
    blockHash: block.hash,
    actions: functionCallActions(method, args, gasTgas, deposit),
  });
  const outcome = await rpc.sendTransaction(tx.base64);
  if (outcome.status === "failed") {
    const detail = outcome.failures.join(" ");
    throw VaultError.fromPanic(detail) ?? new Error(`${method} failed in ${tx.txHash}: ${detail.slice(0, 300)}`);
  }
  return tx.txHash;
}

const view = (contract: string, method: string, args: object) => rpc.callView(contract, method, args);

async function ensureVaultStorage(r: NearRpc, accountId: string) {
  if ((await r.callView(vaultId, "storage_balance_of", { account_id: accountId })) !== null) return null;
  const bounds = (await r.callView(vaultId, "storage_balance_bounds", {})) as { min: string };
  return send(payer, vaultId, "storage_deposit", { account_id: accountId, registration_only: true }, 30n, BigInt(bounds.min));
}

const config = (await view(vaultId, "get_config", {})) as Record<string, string>;
record("config", { result: config });
if (config.approved_usdc_token_contract !== usdc) throw new Error("USDC_CONTRACT_ID is not the vault's approved token");

const storage = new TokenStorage({ rpc, tokenContractId: usdc, payer });
for (const account of new Set([payer.accountId, depositAddress])) {
  record(`usdc storage ${account}`, { result: await storage.ensure(account) });
}
record("vault storage", { tx: (await ensureVaultStorage(rpc, payer.accountId)) ?? "already registered" });

const wallet = BigInt((await view(usdc, "ft_balance_of", { account_id: payer.accountId })) as string);
const before = await vault.getBalance(payer.accountId);
record("balances before", { result: { wallet, vault: before } });
const shortfall = units * 2n - before.available;
if (shortfall > 0n) {
  if (wallet < shortfall) {
    console.error(`Not enough test USDC: ${payer.accountId} holds ${wallet}, the run needs ${shortfall} more.`);
    console.error("Get NEAR testnet USDC from https://faucet.circle.com (choose NEAR Testnet) and run this again.");
    process.exit(2);
  }
  record("top up", { tx: await send(payer, usdc, "ft_transfer_call", { receiver_id: vaultId, amount: shortfall.toString(), msg: "" }, 100n, 1n) });
}

const stamp = Date.now().toString(36);
const order = { orderId: `po_testnet_${stamp}`, payer: payer.accountId, depositAddress, amount: units, corridor: "NG-NGN-bank" };
const expiresAtNs = BigInt(Date.now() + 30 * 60_000) * 1_000_000n;

record("register_order", { tx: (await vault.registerOrder({ ...order, expiresAtNs })).txHash });
record("receipt after register", { result: await vault.getReceipt(order.orderId) });
record("payout", {
  tx: await send(payer, vaultId, "payout", { order_id: order.orderId, amount: units.toString(), deposit_address: depositAddress }, 60n),
});
record("set_status with_provider", { tx: (await vault.setStatus(order.orderId, "with_provider", { provider: "testnet-run" })).txHash });
record("set_status paying_out", { tx: (await vault.setStatus(order.orderId, "paying_out", { providerOrder: `run_${stamp}` })).txHash });
record("set_status settled", { tx: (await vault.setStatus(order.orderId, "settled", {})).txHash });
record("receipt after settle", { result: await vault.getReceipt(order.orderId) });

const released = { ...order, orderId: `po_testnet_${stamp}_r` };
record("register_order (to release)", { tx: (await vault.registerOrder({ ...released, expiresAtNs })).txHash });
record("balance while reserved", { result: await vault.getBalance(payer.accountId) });
record("release_order", { tx: (await vault.releaseOrder(released.orderId)).txHash });
record("receipt after release", { result: await vault.getReceipt(released.orderId) });
record("unknown order", { result: await vault.getReceipt(`po_testnet_${stamp}_missing`) });
record("balances after", {
  result: { wallet: await view(usdc, "ft_balance_of", { account_id: payer.accountId }), vault: await vault.getBalance(payer.accountId) },
});
console.log(`done: ${steps.length} steps`);
