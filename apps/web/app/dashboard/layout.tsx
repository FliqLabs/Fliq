import Image from "next/image";
import Link from "next/link";

const navigation = ["Payouts", "Webhooks", "API keys", "Docs"];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-zinc-950">
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
          {navigation.map((item) =>
            item === "Payouts" ? (
              <Link
                key={item}
                href="/dashboard"
                aria-current="page"
                className="whitespace-nowrap rounded-lg bg-zinc-100 px-3 py-2.5 text-sm font-semibold"
              >
                {item}
              </Link>
            ) : (
              <span key={item} className="whitespace-nowrap px-3 py-2.5 text-sm text-zinc-400">
                {item}
              </span>
            ),
          )}
        </nav>
        <p className="mt-auto hidden border-t border-zinc-100 pt-5 text-xs text-zinc-500 lg:block">
          Workspace access is coming soon
        </p>
      </aside>
      <div className="min-w-0 lg:pl-[232px]">{children}</div>
    </div>
  );
}
