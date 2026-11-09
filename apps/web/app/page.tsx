import { MarketingActionLink } from "./components/marketing-action-link";
import { MarketingShell } from "./components/marketing-shell";
import { siteContainer } from "./components/site-container";
import { IconRow, eyebrow } from "./landing/components";
import { providerIcons } from "./landing/data";
import { Finale } from "./landing/finale";
import { HeroStage } from "./landing/hero-stage";
import { Agents, Developers, HowItWorks, Trust } from "./landing/sections";

function Hero() {
  return (
    <section
      className={`${siteContainer} mt-7 grid gap-10 pb-20 pt-14 lg:min-h-[862px] lg:grid-cols-[560px_1fr] lg:gap-0 lg:pb-0 lg:pt-0`}
    >
      <div className="lg:pt-40">
        <p
          id="rates"
          className="mb-5 inline-flex flex-wrap items-center gap-2 rounded-full border border-zinc-700 px-3 py-2 text-xs text-zinc-400"
        >
          <span className="size-1.5 rounded-full bg-brand" />
          Live now: <strong className="font-medium text-zinc-100">₦1,376.32 per $1</strong>
          <span>after fees ↗</span>
        </p>
        <p className={`${eyebrow} mb-4`}>Global crypto. Local money.</p>
        <h1 className="max-w-[550px] text-[clamp(42px,11vw,64px)] leading-[1.03] font-bold tracking-[-0.04em]">
          Dollars in,
          <br />
          your bank account
          <br />
          out<span className="text-zinc-500">.</span>
        </h1>
        <p className="mt-6 max-w-[518px] text-base leading-7 text-zinc-400 sm:text-lg">
          Any chain. Any bank or mobile money. The shortest distance between stablecoins and money you can
          use.
        </p>
        <div className="mt-7 flex flex-wrap gap-2.5">
          <MarketingActionLink href="/create-workspace">Get started</MarketingActionLink>
          <MarketingActionLink href="/rates" variant="secondary">
            Explore rates
          </MarketingActionLink>
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <IconRow icons={providerIcons} label="Payout providers" />
          <p className="text-sm text-zinc-500">Routed across 4 providers</p>
        </div>
      </div>

      <HeroStage />
    </section>
  );
}
export default function HomePage() {
  return (
    <MarketingShell>
      <div className="flow-root overflow-x-clip bg-[linear-gradient(180deg,#171717_0%,#0b0b0b_60%,#000_100%)]">
        <main>
          <Hero />
          <HowItWorks />
          <Developers />
          <Agents />
          <Trust />
          <Finale />
        </main>
      </div>
    </MarketingShell>
  );
}
