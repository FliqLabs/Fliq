import Link from "next/link";
import { siteContainer } from "./site-container";

const navigation = [
  { label: "Rates", href: "/#rates" },
  { label: "Docs", href: "/#developers" },
  { label: "Trust", href: "/#trust" },
  { label: "Sandbox", href: "/#sandbox" },
];

export function SiteFooter() {
  return (
    <footer
      className={`${siteContainer} flex flex-wrap items-center justify-between gap-5 border-t border-zinc-800 bg-canvas py-8 text-sm text-zinc-500`}
    >
      <p>Built on NEAR · MIT licence · NEAR HACKATHON</p>
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
