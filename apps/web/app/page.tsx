import Link from "next/link";
import { MarketingActionLink } from "./components/marketing-action-link";
import { MarketingShell } from "./components/marketing-shell";
import { IconRow } from "./landing/components";
import { providerIcons } from "./landing/data";
import { Finale } from "./landing/finale";
import { HeroStage } from "./landing/hero-stage";
import { Agents, Developers, HowItWorks, Trust } from "./landing/sections";

type Moment = {
  title: string;
  detail: string;
  sphere: string;
  dark?: boolean;
  action?: string;
  place: string;
  delay: string;
};

/* Moments from a real payout day, taken from the API fixtures, floating around the phone. */
const moments: Moment[] = [
  {
    title: "DARA OKONKWO got ₦68,816",
    detail: "21 seconds · via Paycrest",
    sphere: "radial-gradient(circle at 30% 30%,#ffb3f0,#c13fd1 55%,#7a1d9c)",
    place: "top-[14%] left-0",
    delay: "0s",
  },
  {
    title: "@tobi requested $120.00",
    detail: "Studio rent, Nov",
    sphere: "radial-gradient(circle at 30% 30%,#ffd0a8,#f08a45 55%,#b5521c)",
    action: "Pay",
    place: "bottom-[22%] left-[6%]",
    delay: "-2.4s",
  },
  {
    title: "You sent DARA ₦68,816",
    detail: "✓ Paid in 21 seconds",
    sphere: "radial-gradient(circle at 30% 30%,#b9c6ff,#4f6bff 55%,#2337b8)",
    dark: true,
    place: "top-[6%] right-0",
    delay: "-1.2s",
  },
  {
    title: "$199.98 landed",
    detail: "200 USDC from Solana · 34s",
    sphere: "radial-gradient(circle at 30% 30%,#b8f2e6,#3fb8a0 55%,#1a7a68)",
    place: "bottom-[30%] right-[4%]",
    delay: "-3.6s",
  },
];

function MomentCard({ moment }: { moment: Moment }) {
  return (
    <div
      className={`absolute ${moment.place} flex items-center gap-3 rounded-2xl py-2.5 pr-3 pl-2.5 motion-safe:animate-float ${
        moment.dark
          ? "bg-zinc-950 text-white shadow-[0_18px_40px_-16px_rgba(10,10,20,0.6)]"
          : "border border-black/[0.05] bg-white text-zinc-950 shadow-[0_18px_40px_-18px_rgba(20,20,40,0.3)]"
      }`}
      style={{ animationDelay: moment.delay }}
    >
      <span className="size-9 shrink-0 rounded-full" style={{ background: moment.sphere }} />
      <span className="flex flex-col pr-1">
        <span className="text-[14px] font-medium whitespace-nowrap">{moment.title}</span>
        <span className={`text-[12.5px] whitespace-nowrap ${moment.dark ? "text-zinc-400" : "text-zinc-500"}`}>{moment.detail}</span>
      </span>
      {moment.action && (
        <span className="rounded-full bg-zinc-950 px-3 py-1.5 text-[12.5px] font-semibold text-white">{moment.action}</span>
      )}
    </div>
  );
}

function Hero() {
  return (
    <section className="relative overflow-x-clip pt-[120px] sm:pt-[150px]">
      <div className="mx-auto flex max-w-[980px] flex-col items-center px-5 text-center">
        <Link
          href="/rates"
          className="mb-7 inline-flex flex-wrap items-center justify-center gap-2 rounded-full border border-black/[0.06] bg-white px-3.5 py-2 text-[13px] text-zinc-600 shadow-[0_1px_2px_rgba(20,20,40,0.05)] transition-colors hover:text-zinc-950"
        >
          <span className="size-1.5 rounded-full bg-[#5B4BE0]" />
          Live now: <strong className="font-semibold text-zinc-950">₦1,376.32 per $1</strong> after fees ↗
        </Link>
        <h1 className="text-[clamp(46px,8.4vw,96px)] leading-[0.98] font-semibold tracking-[-0.045em] text-balance">
          Dollars in, your bank account out.
        </h1>
        <p className="mt-7 max-w-[600px] text-[17px] leading-7 text-zinc-600 sm:text-lg">
          Hold dollars in your own vault on NEAR. Send them to any bank or mobile money account in Nigeria and Kenya,
          at the best of four rates, in about 21 seconds.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <MarketingActionLink href="/sign-in" variant="ink">
            Get started
          </MarketingActionLink>
          <MarketingActionLink href="#how-it-works" variant="outline">
            See how it works
          </MarketingActionLink>
        </div>
        <div className="mt-7 flex items-center gap-3">
          <IconRow icons={providerIcons} label="Payout providers" light />
          <p className="text-sm text-zinc-500">Routed across 4 licensed providers</p>
        </div>
      </div>

      <div className="relative mx-auto mt-6 max-w-[1180px] px-5">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden lg:block">
          {moments.map((moment) => (
            <MomentCard key={moment.title} moment={moment} />
          ))}
        </div>
        <HeroStage light />
      </div>
    </section>
  );
}

export default function HomePage() {
  return (
    <MarketingShell tone="light">
      <div className="flow-root overflow-x-clip bg-[radial-gradient(120%_70%_at_50%_0%,#ffffff_0%,#F4F4F5_60%)]">
        <main>
          <Hero />
          <div className="mx-2.5 rounded-[32px] bg-black pt-14 pb-4 text-white sm:mx-4 lg:rounded-[44px] lg:pt-20">
            <HowItWorks />
            <Developers />
          </div>
          <div className="pt-16 lg:pt-24">
            <Agents />
            <Trust />
          </div>
          <Finale />
        </main>
      </div>
    </MarketingShell>
  );
}
