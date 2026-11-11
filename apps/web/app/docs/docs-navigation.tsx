"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { docsPages, docsTopLinks } from "./navigation";

export function DocsNavigation() {
  const pathname = usePathname();
  const links = docsPages.map(({ slug, title }) => (
    <Link
      key={slug}
      href={`/docs/${slug}`}
      aria-current={pathname === `/docs/${slug}` ? "page" : undefined}
      className={`block rounded-lg px-3 py-[7px] text-[13px] transition-colors hover:bg-[#f6f6f6] hover:text-[#0a0a0a] ${pathname === `/docs/${slug}` ? "bg-[#f6f6f6] font-semibold text-[#0a0a0a]" : "text-[#6b6b6b]"}`}
    >
      {title}
    </Link>
  ));

  return (
    <>
      <a
        href="#docs-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:bg-white focus:p-3"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 flex min-h-[60px] flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-[#e6e6e6] bg-white px-5 py-3 lg:px-10">
        <Link href="/" aria-label="Fliq home" className="flex items-center gap-2.5">
          <Image
            src="/docs/fliq.png"
            alt=""
            width={26}
            height={26}
            className="size-[26px] rounded-full object-cover"
          />
          <span className="font-[family-name:var(--font-docs-outfit)] text-base font-bold tracking-tight">
            fliq
          </span>
          <span className="ml-1.5 text-[13px] text-[#6b6b6b]">Docs</span>
        </Link>
        <nav
          aria-label="Docs header"
          className="flex flex-wrap items-center gap-4 text-[13px] font-medium sm:gap-[22px]"
        >
          {docsTopLinks.map(({ href, title }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              className={pathname === href ? "text-[#0a0a0a]" : "text-[#6b6b6b] hover:text-[#0a0a0a]"}
            >
              {title}
            </Link>
          ))}
          <Link
            href="/dashboard/api-keys"
            className="rounded-[10px] border border-[#111] bg-[#111] px-3.5 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-zinc-700"
          >
            Dashboard
          </Link>
        </nav>
      </header>
      <aside className="fixed top-[60px] bottom-0 left-0 hidden w-60 overflow-y-auto border-r border-[#e6e6e6] bg-white px-5 py-7 lg:block">
        <nav aria-label="Docs sidebar" className="flex flex-col gap-0.5">
          {links}
        </nav>
      </aside>
      <details key={pathname} className="border-b border-[#e6e6e6] bg-white px-5 py-3 lg:hidden">
        <summary className="cursor-pointer text-[13px] font-semibold">Browse documentation</summary>
        <nav aria-label="Mobile docs sidebar" className="mt-3 grid gap-0.5 sm:grid-cols-2">
          {links}
        </nav>
      </details>
    </>
  );
}
