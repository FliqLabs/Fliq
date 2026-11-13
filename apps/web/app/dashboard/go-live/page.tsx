import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { GoLiveForm } from "./go-live-form";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Go live | Fliq",
  description: "Prepare your business for live payouts with Fliq.",
};

export default function GoLivePage() {
  return (
    <div className={inter.className}>
      <GoLiveForm />
    </div>
  );
}
