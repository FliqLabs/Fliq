import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppFrame } from "../components/app/app-frame";

export const metadata: Metadata = {
  title: "fliq",
  description: "Send dollars from your fliq vault to any bank or mobile money account.",
};

export default function WalletLayout({ children }: { children: ReactNode }) {
  return <AppFrame mode="wallet">{children}</AppFrame>;
}
