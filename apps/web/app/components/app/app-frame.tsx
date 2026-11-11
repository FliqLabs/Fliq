import { Suspense, type ReactNode } from "react";
import { Inter, Outfit } from "next/font/google";
import { AppShell } from "./app-shell";
import { ToastProvider } from "./ui";
import "./app.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", weight: ["300", "400", "500", "600", "700"] });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", weight: ["600", "700"] });

/* Runs before the first paint so a dark choice never flashes light. Kept here, not in the client theme module,
   because a server component needs the string itself. */
const themeScript = `try{var t=localStorage.getItem("fliq-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

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
