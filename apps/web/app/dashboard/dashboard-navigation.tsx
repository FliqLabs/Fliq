"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fliqApi, type User } from "../lib/fliq-api";

const links = [
  { label: "Payouts", href: "/dashboard" },
  { label: "Webhooks", href: "/dashboard/webhooks" },
  { label: "API keys", href: "/dashboard/api-keys" },
  { label: "Profile", href: "/dashboard/profile" },
];

export function DashboardNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const account = useQuery({ queryKey: ["me"], queryFn: () => fliqApi<User>("me") });
  const logout = useMutation({
    mutationFn: () => fliqApi<void>("auth/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.clear();
      router.replace("/sign-in");
    },
  });
  const title =
    links.find((link) => link.href !== "/dashboard" && pathname.startsWith(link.href))?.label ?? "Payouts";

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
            const active = href === "/dashboard" ? title === "Payouts" : pathname.startsWith(href);
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
          <Link
            href="/#developers"
            className="whitespace-nowrap rounded-lg px-3 py-2.5 text-sm text-zinc-500 hover:bg-zinc-50"
          >
            Docs
          </Link>
          {account.isSuccess && (
            <button
              type="button"
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
              className="whitespace-nowrap px-3 py-2.5 text-left text-sm text-zinc-500 lg:hidden"
            >
              Sign out
            </button>
          )}
        </nav>
        <div className="mt-auto hidden border-t border-zinc-100 pt-5 text-xs lg:block">
          <p className="truncate text-zinc-500">
            {account.data?.display_name ?? account.data?.near_account ?? "Workspace"}
          </p>
          {account.isSuccess && (
            <button
              type="button"
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
              className="mt-2 font-semibold hover:underline disabled:opacity-50"
            >
              Sign out
            </button>
          )}
          {logout.isError && (
            <p role="alert" className="mt-2 text-red-600">
              {logout.error.message}
            </p>
          )}
        </div>
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
