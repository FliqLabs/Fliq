import type { ReactNode } from "react";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });

export default function ApiKeysLayout({ children }: { children: ReactNode }) {
  return <div className={inter.className}>{children}</div>;
}
