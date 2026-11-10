import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

export function MarketingShell({ children, tone = "dark" }: { children: React.ReactNode; tone?: "dark" | "light" }) {
  return (
    <div className={`flex min-h-screen flex-col ${tone === "light" ? "bg-[#F4F4F5] text-zinc-950" : "bg-canvas text-white"}`}>
      <SiteHeader tone={tone} />
      <div className="flex-1">{children}</div>
      <SiteFooter tone={tone} />
    </div>
  );
}
