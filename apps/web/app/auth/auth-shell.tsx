import Image from "next/image";
import Link from "next/link";
import { BrandVideo } from "./brand-video";

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

      <aside className="sticky top-0 hidden h-screen items-center overflow-hidden bg-black lg:flex">
        <BrandVideo />
      </aside>
    </main>
  );
}
