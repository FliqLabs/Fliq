import Image from "next/image";
import Link from "next/link";
import { siteContainer } from "./site-container";

const navigation = [
  { label: "Rates", href: "/rates", visibility: "md:inline-flex" },
  { label: "Agents", href: "/agents", visibility: "md:inline-flex" },
  { label: "Pricing", href: "/pricing", visibility: "md:inline-flex" },
  { label: "Docs", href: "/#developers", visibility: "md:inline-flex" },
  { label: "Status", href: "/status", visibility: "lg:inline-flex" },
];

export function SiteHeader({ activeHref, brandClassName }: { activeHref?: string; brandClassName?: string }) {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 pt-3">
      <div className={siteContainer}>
        <div className="pointer-events-auto grid h-14 grid-cols-[1fr_auto] items-center rounded-full border border-white/[0.08] bg-[#161616]/85 pr-2 pl-5 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl md:grid-cols-[1fr_auto_1fr]">
          <Link
            href="/"
            aria-label="Fliq home"
            className="inline-flex w-fit items-center gap-2 text-[22px] font-semibold tracking-tight text-white"
          >
            <Image src="/logo.png" width={28} height={28} alt="" className="size-7 rounded-full" />
            <span className={brandClassName}>fliq</span>
          </Link>
          <nav aria-label="Main navigation" className="hidden items-center gap-1 md:flex">
            {navigation.map(({ label, href, visibility }) => (
              <Link
                key={label}
                href={href}
                aria-current={activeHref === href ? "page" : undefined}
                className={`hidden ${visibility} h-9 items-center rounded-full px-3.5 text-[15px] transition-colors hover:text-white ${activeHref === href ? "bg-white/[0.07] text-white" : "text-zinc-400"}`}
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center justify-end gap-1.5">
            <Link
              href="/sign-in"
              className="hidden h-10 items-center rounded-full px-4 text-[15px] text-zinc-300 transition-colors hover:text-white sm:inline-flex"
            >
              Log in
            </Link>
            <details className="group relative md:hidden">
              <summary
                aria-label="Menu"
                className="grid size-10 cursor-pointer list-none place-items-center rounded-full text-zinc-300 hover:text-white [&::-webkit-details-marker]:hidden"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <path d="M4 8h16M4 16h16" />
                </svg>
              </summary>
              <nav
                aria-label="Mobile navigation"
                className="absolute top-12 right-0 flex w-52 flex-col rounded-2xl border border-white/[0.08] bg-[#161616] p-2 shadow-2xl"
              >
                {[...navigation, { label: "Log in", href: "/sign-in" }].map(({ label, href }) => (
                  <Link key={label} href={href} className="rounded-xl px-3 py-2.5 text-[15px] text-zinc-300 hover:bg-white/[0.06] hover:text-white">
                    {label}
                  </Link>
                ))}
              </nav>
            </details>
            <Link
              href="/create-workspace"
              className="inline-flex h-10 items-center rounded-full bg-white px-5 text-[15px] font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
            >
              Get started
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
