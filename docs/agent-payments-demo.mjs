import { createHash } from "node:crypto";
import {
  actions,
  baseDecode,
  baseEncode,
  createTransaction,
  encodeTransaction,
  KeyPair,
  KeyPairSigner,
} from "near-api-js";

const apiUrl = process.env.DEMO_API_URL;
const agentAccount = process.env.AGENT_ACCOUNT;
const privateKey = process.env.AGENT_PRIVATE_KEY;
const rpcUrl = process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org";

if (!apiUrl || !agentAccount || !privateKey) {
  throw new Error("Set DEMO_API_URL, AGENT_ACCOUNT and AGENT_PRIVATE_KEY.");
}

const keyPair = KeyPair.fromString(privateKey);
const publicKey = keyPair.getPublicKey();

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "demo", method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`NEAR RPC: ${body.error.data ?? body.error.message}`);
  return body.result;
}

function signedHeaders(method, path, timestamp) {
  const bodyHash = createHash("sha256").update("", "utf8").digest("hex");
  const message = [method, path, timestamp, bodyHash].join("\n");
  const signature = Buffer.from(keyPair.sign(new TextEncoder().encode(message)).signature).toString("base64");
  return {
    "x-fliq-agent": agentAccount,
    "x-fliq-timestamp": timestamp,
    "x-fliq-signature": signature,
  };
}

async function payout(vaultAccount, orderId, amount, depositAddress) {
  const access = await rpc("query", {
    request_type: "view_access_key",
    finality: "final",
    account_id: agentAccount,
    public_key: publicKey.toString(),
  });
  const block = await rpc("block", { finality: "final" });
  const transaction = createTransaction(
    agentAccount,
    publicKey,
    vaultAccount,
    BigInt(access.nonce) + 1n,
    [
      actions.functionCall(
        "payout",
        { order_id: orderId, amount, deposit_address: depositAddress },
        50n * 1_000_000_000_000n,
        0n,
      ),
    ],
    baseDecode(block.header.hash),
  );
  const { txHash, signedTransaction } = await new KeyPairSigner(keyPair).signTransaction(transaction);
  const base64 = Buffer.from(encodeTransaction(signedTransaction)).toString("base64");
  const result = await rpc("broadcast_tx_commit", [base64]);
  return { txHash: baseEncode(txHash), result };
}

async function call(payment) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const url = new URL(apiUrl);
  const headers = signedHeaders("GET", url.pathname + url.search, timestamp);
  if (payment) headers["x-fliq-payment"] = payment;
  return fetch(url, { headers }).then(async (response) => ({
    status: response.status,
    body: await response.json(),
  }));
}

const first = await call();
if (first.status !== 402) throw new Error(`Expected 402, got ${first.status}.`);

const payment = first.body;
const paid = await payout(payment.vault_account, payment.order_id, payment.price, payment.pay_to_address);
console.log(`payout tx: ${paid.txHash}`);

const retried = await call(payment.order_id);
console.log(`paid retry: ${retried.status}`);
if (retried.status !== 200) throw new Error("The paid retry did not return 200.");

const second = await call();
if (second.status !== 402) throw new Error(`Expected a second 402, got ${second.status}.`);
const refused = await payout(
  second.body.vault_account,
  second.body.order_id,
  second.body.price,
  second.body.pay_to_address,
);
console.log(`over-daily attempt tx: ${refused.txHash}`);
