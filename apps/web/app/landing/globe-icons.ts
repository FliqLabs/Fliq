export type GlobeIcon = { src: string; kind: "flag" | "token" | "bank" };

const flags = "ng ke gh za ug tz rw cm sn ci eg ma et us gb eu ca ae in ph id br jp cn de fr".split(" ");
const tokens = "usdc usdt btc eth sol matic trx bnb dai xrp ada avax".split(" ");
const appLogos = "gtbank access-bank opay mpesa paycrest busha bitnob fonbnk".split(" ");
const bankLogos = "zenith-bank moniepoint ecobank".split(" ");

export const globeIcons: GlobeIcon[] = [
  ...flags.map((code) => ({ src: `/landing/icons/flags/${code}.svg`, kind: "flag" as const })),
  ...tokens.map((symbol) => ({ src: `/landing/icons/tokens/${symbol}.svg`, kind: "token" as const })),
  { src: "/landing/tokens/near.webp", kind: "token" },
  ...appLogos.map((name) => ({ src: `/app/${name}.webp`, kind: "bank" as const })),
  ...bankLogos.map((name) => ({ src: `/landing/icons/banks/${name}.svg`, kind: "bank" as const })),
];
