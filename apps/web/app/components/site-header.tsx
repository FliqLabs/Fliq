import Image from "next/image";
import Link from "next/link";
import { siteContainer } from "./site-container";

const navigation = [
  { label: "Rates", href: "/#rates", visibility: "sm:inline" },
  { label: "Docs", href: "/#developers", visibility: "sm:inline" },
  { label: "Agents", href: "/#agents", visibility: "sm:inline" },
  { label: "Pricing", href: "/pricing", visibility: "inline" },
  { label: "Status", href: "/#trust", visibility: "lg:inline" },
];

export function SiteHeader({ activeHref, brandClassName }: { activeHref?: string; brandClassName?: string }) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 bg-[#161616]">
      <div className={`${siteContainer} flex min-h-[68px] items-center justify-between gap-6 py-4`}>
        <Link
          href="/"
          aria-label="Fliq home"
          className="inline-flex items-center gap-2.5 text-2xl font-bold tracking-tight text-white"
        >
          <Image src="/logo.png" width={60} height={30} alt="" />
          <span className={brandClassName}>Fliq</span>
        </Link>
        <nav aria-label="Main navigation" className="flex items-center gap-4 text-sm text-zinc-400 lg:gap-6">
          {navigation.map(({ label, href, visibility }) => (
            <Link
              key={label}
              href={href}
              aria-current={activeHref === href ? "page" : undefined}
              className={`${visibility === "inline" ? "inline" : `hidden ${visibility}`} hover:text-white ${activeHref === href ? "text-white" : ""}`}
            >
              {label}
            </Link>
          ))}
          <Link
            href="/join-waitlist"
            className="rounded-xl bg-white px-4 py-2.5 font-semibold text-black transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
          >
            Join waitlist
          </Link>
        </nav>
      </div>
    </header>
  );
}
