import { Suspense, type ReactNode } from "react";
import { Inter, Outfit } from "next/font/google";
import { AppShell } from "./app-shell";
import { ToastProvider } from "./ui";
import "./app.css";
import { themeScript } from "./theme-script";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["300", "400", "500", "600", "700"],
});
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", weight: ["600", "700"] });

export function AppFrame({ mode, children }: { mode: "wallet" | "developer"; children: ReactNode }) {
  return (
    <div className={`fliq-app ${inter.variable} ${outfit.variable}`}>
      <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      <ToastProvider>
        <Suspense fallback={<div className="app" />}>
          <AppShell mode={mode}>{children}</AppShell>
        </Suspense>
      </ToastProvider>
    </div>
  );
}
