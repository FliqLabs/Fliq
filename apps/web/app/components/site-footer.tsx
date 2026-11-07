import Image from "next/image";
import Link from "next/link";
import { siteContainer } from "./site-container";

const navigation = [
  { label: "Rates", href: "/rates/ngn" },
  { label: "Docs", href: "/#developers" },
  { label: "Trust", href: "/#trust" },
  { label: "Sandbox", href: "/#sandbox" },
];

export function SiteFooter() {
  return (
    <footer
      className={`${siteContainer} flex flex-wrap items-center justify-between gap-5 border-t border-zinc-800 py-8 text-sm text-zinc-500`}
    >
      <p className="flex items-center gap-2">
        <Image src="/logo.png" alt="" width={40} height={20} className="h-5 w-auto shrink-0" />
        <span>Built on NEAR · MIT licence · NEAR HACKATHON</span>
      </p>
      <nav aria-label="Footer navigation" className="flex flex-wrap gap-5">
        {navigation.map(({ label, href }) => (
          <Link key={label} href={href} className="hover:text-white">
            {label}
          </Link>
        ))}
      </nav>
    </footer>
  );
}
