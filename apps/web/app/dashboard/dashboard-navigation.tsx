"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { label: "Payouts", href: "/dashboard" },
  { label: "Webhooks", href: "/dashboard/webhooks" },
];

export function DashboardNavigation() {
  const pathname = usePathname();
  const title = pathname.startsWith("/dashboard/webhooks") ? "Webhooks" : "Payouts";

  return (
    <>
      <aside className="border-b border-zinc-200 px-4 py-5 lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:flex lg:w-[232px] lg:flex-col lg:border-r lg:border-b-0 lg:bg-white">
        <Link
          href="/"
          aria-label="Fliq home"
          className="mb-7 inline-flex items-center gap-2 text-xl font-bold"
        >
          <Image src="/logo.png" width={26} height={26} alt="" className="size-7 rounded-full" />
          fliq
        </Link>
        <nav aria-label="Dashboard navigation" className="flex gap-1 overflow-x-auto lg:flex-col">
          {links.map(({ label, href }) => {
            const active =
              href === "/dashboard" ? !pathname.startsWith("/dashboard/webhooks") : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-semibold ${active ? "bg-zinc-100 text-zinc-950" : "text-zinc-500 hover:bg-zinc-50"}`}
              >
                {label}
              </Link>
            );
          })}
          <span className="whitespace-nowrap px-3 py-2.5 text-sm text-zinc-400">API keys</span>
          <span className="whitespace-nowrap px-3 py-2.5 text-sm text-zinc-400">Docs</span>
        </nav>
        <p className="mt-auto hidden border-t border-zinc-100 pt-5 text-xs text-zinc-500 lg:block">
          Workspace access is coming soon
        </p>
      </aside>
      <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between border-b border-zinc-200 bg-white px-6 lg:fixed lg:right-0 lg:left-[232px] lg:px-8">
        <p className="text-sm font-semibold">{title}</p>
        <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">
          Sandbox
        </span>
      </header>
    </>
  );
}
