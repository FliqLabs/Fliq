const TESTNET = (process.env.NEXT_PUBLIC_NEAR_RPC_URL ?? "https://rpc.testnet.near.org").includes("testnet");

export function explorerAccountUrl(account: string) {
  return `https://${TESTNET ? "testnet." : ""}nearblocks.io/address/${encodeURIComponent(account)}`;
}

export function explorerTxUrl(hash: string) {
  return `https://${TESTNET ? "testnet." : ""}nearblocks.io/txns/${encodeURIComponent(hash)}`;
}
