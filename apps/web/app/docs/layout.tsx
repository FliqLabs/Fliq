import { Suspense, type ReactNode } from "react";
import { Inter, JetBrains_Mono, Outfit } from "next/font/google";
import { DocsNavigation } from "./docs-navigation";
import "../components/app/theme.css";
import { themeScript } from "../components/app/theme-script";
import "./docs.css";

const inter = Inter({ subsets: ["latin"] });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-docs-mono" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-docs-outfit" });

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${inter.className} ${mono.variable} ${outfit.variable} fliq-docs min-h-screen bg-[var(--panel)] text-[var(--fg)]`}
    >
      <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      <Suspense fallback={<div className="h-[60px] border-b border-[var(--line)]" />}>
        <DocsNavigation />
      </Suspense>
      <div className="lg:pl-60">{children}</div>
    </div>
  );
}
