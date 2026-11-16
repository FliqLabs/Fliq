export type WalletNetwork = "near" | "solana" | "base";

const nearName = /^(?=.{2,64}$)(?:[a-z0-9]+[-_])*[a-z0-9]+(?:\.(?:[a-z0-9]+[-_])*[a-z0-9]+)*$/;
const nearImplicit = /^[0-9a-f]{64}$/;
const baseAddress = /^0x[0-9a-fA-F]{40}$/;
const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function decodedLength(value: string): number {
  let number = 0n;
  for (const character of value) number = number * 58n + BigInt(alphabet.indexOf(character));
  let length = 0;
  while (number > 0n) {
    number >>= 8n;
    length++;
  }
  return (value.match(/^1*/)?.[0].length ?? 0) + length;
}

export function walletAddress(typed: string, chain: WalletNetwork): string {
  const trimmed = typed.trim();
  return chain === "near" ? trimmed.toLowerCase() : trimmed;
}

export function walletAddressError(address: string, chain: WalletNetwork): string | null {
  if (!address) return "Enter a wallet address.";
  if (chain === "solana") {
    if (address.startsWith("0x"))
      return "That's a Base or Ethereum address. Choose Base above to send it there.";
    if (base58.test(address) && decodedLength(address) === 32) return null;
    return "That isn't a Solana address.";
  }
  if (chain === "base") {
    return baseAddress.test(address)
      ? null
      : "That isn't a Base address. It starts with 0x and has 42 characters.";
  }
  if (baseAddress.test(address))
    return "That's a Base or Ethereum address. Choose Base above to send it there.";
  return nearName.test(address) || nearImplicit.test(address) ? null : "That isn't a NEAR address.";
}

export function shortWalletAddress(address: string): string {
  return address.length > 16 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;
}
