import type { DepositSource, ProviderId } from "./wallet-api";

export const PROVIDERS: Record<ProviderId, { name: string; logo: string | null }> = {
  paycrest: { name: "Paycrest", logo: "/app/paycrest.webp" },
  busha: { name: "Busha", logo: "/app/busha.webp" },
  fonbnk: { name: "Fonbnk", logo: "/app/fonbnk.webp" },
  bitnob: { name: "Bitnob", logo: "/app/bitnob.webp" },
  transfi: { name: "TransFi", logo: null },
  mock: { name: "Sandbox provider", logo: null },
};

export function providerName(provider: string | null | undefined) {
  return provider && provider in PROVIDERS ? PROVIDERS[provider as ProviderId].name : "Provider";
}

const BANKS: Record<string, string> = {
  "058": "/app/gtbank.webp",
  gtbank: "/app/gtbank.webp",
  "044": "/app/access-bank.webp",
  "access-bank": "/app/access-bank.webp",
  "999992": "/app/opay.webp",
  opay: "/app/opay.webp",
  mpesa: "/app/mpesa.webp",
  "m-pesa": "/app/mpesa.webp",
};

/** Matches on the logo key, the institution code or the name, in that order. */
export function bankLogo(...keys: (string | null | undefined)[]) {
  for (const key of keys) {
    const logo = key ? BANKS[key.toLowerCase()] : undefined;
    if (logo) return logo;
  }
  return null;
}

const CHAINS: Record<DepositSource["chain"], { name: string; logo: string }> = {
  base: { name: "Base", logo: "/landing/tokens/base.webp" },
  solana: { name: "Solana", logo: "/landing/tokens/solana.webp" },
  tron: { name: "Tron", logo: "/landing/tokens/tron.webp" },
  arbitrum: { name: "Arbitrum", logo: "/landing/tokens/arbitrum.webp" },
  ethereum: { name: "Ethereum", logo: "/landing/tokens/ethereum.webp" },
  polygon: { name: "Polygon", logo: "/app/polygon.webp" },
  bnb: { name: "BNB Chain", logo: "/landing/icons/tokens/bnb.svg" },
  monad: { name: "Monad", logo: "/landing/tokens/usdc.webp" },
  bitcoin: { name: "Bitcoin", logo: "/landing/tokens/btc.webp" },
  near: { name: "NEAR", logo: "/landing/tokens/near.webp" },
};

export function chain(id: string) {
  return CHAINS[id as DepositSource["chain"]] ?? { name: id, logo: "/landing/tokens/usdc.webp" };
}

const TOKEN_LOGOS: Record<string, string> = {
  usdt: "/landing/tokens/usdt.webp",
  btc: "/landing/tokens/btc.webp",
  sol: "/landing/tokens/solana.webp",
  eth: "/landing/tokens/ethereum.webp",
  bnb: "/landing/icons/tokens/bnb.svg",
};

export function tokenLogo(token: string) {
  return TOKEN_LOGOS[token] ?? "/landing/tokens/usdc.webp";
}

/** Not a dollar: swapped to USDC as it lands, so what arrives is priced then. */
export function isSwapped(source: Pick<DepositSource, "group">) {
  return source.group === "bitcoin" || source.group === "coins";
}

/** A chain's own coin on its own chain (SOL on Solana), drawn without a network badge. */
export function isNativeCoin(source: Pick<DepositSource, "token" | "chain">) {
  return ({ btc: "bitcoin", sol: "solana", eth: "ethereum", bnb: "bnb" } as Record<string, string>)[source.token] === source.chain;
}

/** People without a photo get the shared silhouette, tinted by their name so a list stays tellable apart. */
export function avatarHue(name: string) {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % 360;
}
