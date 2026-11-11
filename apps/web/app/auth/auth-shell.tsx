import Image from "next/image";
import Link from "next/link";
import { AnimatedRateBadge } from "./animated-rate-badge";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen bg-white text-zinc-950 lg:grid-cols-2">
      <section className="flex min-h-screen flex-col px-6 py-7 sm:px-10">
        <Link
          href="/"
          aria-label="Fliq home"
          className="inline-flex w-fit items-center gap-2 text-xl font-bold"
        >
          <Image src="/logo.png" width={28} height={28} alt="" className="size-7 rounded-full" />
          fliq
        </Link>
        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-16">
          {children}
        </div>
        <p className="text-xs text-zinc-400">Sandbox needs no KYB. Live keys need a verified business.</p>
      </section>

      <aside className="relative hidden min-h-screen overflow-hidden bg-[#151515] text-white lg:flex lg:items-center lg:justify-center">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,#332365_0%,#1c1930_37%,transparent_70%)]" />
        <div className="relative w-full max-w-[524px] px-8">
          <p className="mb-4 text-sm text-zinc-400">USDC to NGN bank, after fees</p>
          <AnimatedRateBadge />
          <p className="mt-5 text-xs text-emerald-400">Sample rate · Paycrest</p>
          <div className="mt-8 rounded-2xl border border-zinc-800 bg-[#1a1a1a] p-6">
            <p className="mb-6 text-xs font-semibold uppercase tracking-wide text-zinc-400">Sample payout</p>
            <ol className="space-y-6 text-sm">
              <li>
                <span className="mr-3 text-emerald-400">✓</span>Left a NEAR vault · 50.00 USDC
              </li>
              <li>
                <span className="mr-3 text-emerald-400">✓</span>Routed with Paycrest
              </li>
              <li>
                <span className="mr-3 text-emerald-400">✓</span>₦68,816 paid to a bank · 21 seconds
              </li>
            </ol>
          </div>
        </div>
      </aside>
    </main>
  );
}
