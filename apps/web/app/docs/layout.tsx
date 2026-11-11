import { Suspense, type ReactNode } from "react";
import { Inter, JetBrains_Mono, Outfit } from "next/font/google";
import { DocsNavigation } from "./docs-navigation";
import "./docs.css";

const inter = Inter({ subsets: ["latin"] });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-docs-mono" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-docs-outfit" });

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${inter.className} ${mono.variable} ${outfit.variable} min-h-screen bg-white text-[#0a0a0a]`}
    >
      <Suspense fallback={<div className="h-[60px] border-b border-[#e6e6e6]" />}>
        <DocsNavigation />
      </Suspense>
      <div className="lg:pl-60">{children}</div>
    </div>
  );
}
