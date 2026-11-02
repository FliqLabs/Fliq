import type { StaticImageData } from "next/image";
import fliqIcon from "../image/fliq image.png";
import claudeIcon from "../image/claude image.png";
import access from "../image/banks/access.png";
import gtbank from "../image/banks/gtbank.png";
import mpesa from "../image/banks/mopesa.png";
import opay from "../image/banks/opay.png";
import blank from "../image/chains/blank.png";
import dollar from "../image/chains/dollar icon.png";
import near from "../image/chains/near.png";
import solana from "../image/chains/solana image.png";
import paycrest from "../image/providers/image.png";
import busha from "../image/providers/image (1).png";
import fonbnk from "../image/providers/image (2).png";
import bitnob from "../image/providers/image (3).png";
import logo from "../../public/logo.png";

export { fliqIcon, claudeIcon };

export type Icon = {
  src: StaticImageData;
  alt: string;
};

const chainIcons: Icon[] = [
  { src: solana, alt: "Solana" },
  { src: near, alt: "NEAR" },
  { src: dollar, alt: "USDC" },
  { src: blank, alt: "More chains" },
];

export const providerIcons: Icon[] = [
  { src: paycrest, alt: "Paycrest" },
  { src: busha, alt: "Busha" },
  { src: fonbnk, alt: "Fonbnk" },
  { src: bitnob, alt: "Bitnob" },
];

const bankIcons: Icon[] = [
  { src: gtbank, alt: "GTBank" },
  { src: access, alt: "Access Bank" },
  { src: opay, alt: "OPay" },
  { src: mpesa, alt: "M-Pesa" },
];

export const steps = [
  {
    number: "01",
    title: "Send from any chain",
    description:
      "USDC or USDT on Solana, Base, Ethereum, and more. One integration, wherever your money lives.",
    icons: chainIcons,
    iconLabel: "Supported chains",
  },
  {
    number: "02",
    title: "Best of four, every time",
    description:
      "Four providers are quoted in parallel. Your payout takes the best available route, after fees.",
    icons: providerIcons,
    iconLabel: "Payout providers",
  },
  {
    number: "03",
    title: "In the bank in 21 seconds",
    description: "Bank or mobile money in Nigeria and Kenya. A clear receipt from start to settled.",
    icons: bankIcons,
    iconLabel: "Banks and mobile money",
  },
];

export const trustPoints = [
  {
    image: paycrest,
    title: "We never hold the money",
    description:
      "Your stablecoin goes to the provider's per-order address, directly or through NEAR Intents. fliq routes. It never holds the money.",
  },
  {
    image: logo,
    title: "Caps live on chain",
    description:
      "Your vault is a NEAR contract at your name. Limits for agents are enforced there, not in our server.",
  },
  {
    image: gtbank,
    title: "A receipt the bank recognises",
    description:
      "Every payout carries the chain hash, the provider order and the NIP session ID. Check any of them yourself.",
  },
];
