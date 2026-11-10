import Image from "next/image";
import { MarketingActionLink } from "../components/marketing-action-link";
import { siteContainer } from "../components/site-container";
import { IconRow, eyebrow } from "./components";
import { claudeIcon, steps, trustPoints } from "./data";

export function HowItWorks() {
  return (
    <section id="how-it-works" className={`${siteContainer} pb-16 pt-7 lg:pb-24`}>
      <p className={`${eyebrow} mb-6`}>How it works</p>
      <div className="grid gap-4 md:grid-cols-3">
        {steps.map((step) => (
          <article
            key={step.number}
            className="relative min-h-[202px] rounded-[18px] border border-[#2c2c2c] bg-[#1a1a1a] p-6"
          >
            <IconRow icons={step.icons} label={step.iconLabel} />
            <span className="absolute top-8 right-6 font-mono text-xs text-zinc-500">{step.number}</span>
            <h3 className="mt-4 mb-3 text-lg font-semibold tracking-tight">{step.title}</h3>
            <p className="text-sm leading-[22px] text-zinc-400">{step.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function Developers() {
  return (
    <section
      id="developers"
      className={`${siteContainer} grid gap-10 pb-16 md:grid-cols-2 md:items-center lg:pb-24`}
    >
      <div>
        <p className={`${eyebrow} mb-5`}>For developers</p>
        <h2 className="mb-4 text-3xl leading-tight font-bold tracking-tight lg:text-[40px]">
          A withdraw-to-bank button,
          <br />
          in four calls
        </h2>
        <p className="mb-5 max-w-md text-base leading-6 text-zinc-400">
          Quote, create, watch the webhook. One API for the messy part between crypto and a bank account.
        </p>
        <div className="flex flex-wrap gap-2.5">
          <MarketingActionLink href="/create-workspace">Get a sandbox key</MarketingActionLink>
          <MarketingActionLink href="#quickstart" variant="secondary">
            Read the quickstart
          </MarketingActionLink>
        </div>
      </div>
      <div id="quickstart" className="overflow-hidden rounded-xl bg-[#0f0f0f]">
        <pre className="overflow-x-auto p-5 text-xs leading-6 text-zinc-300">
          <code>{`# quote
curl https://api.fliq.cash/v1/quote \\
  -H "Authorization: Bearer rt_test_…" \\
  -d "token=USDC&currency=NGN&amount=50"

{ "rate": 1376.32, "receive": 68816,
  "provider": "paycrest", "best_of": 4 }

# pay, then the webhook brings the bank reference
{ "event": "payout.settled",
  "bank_reference": "000013251029140213" }`}</code>
        </pre>
      </div>
    </section>
  );
}

export function Agents() {
  return (
    <section
      id="agents"
      className={`${siteContainer} mb-16 grid gap-10 rounded-[22px] border border-black/[0.06] bg-white px-6 py-8 shadow-[0_24px_60px_-30px_rgba(20,20,40,0.25)] sm:px-10 md:grid-cols-2 md:items-center lg:mb-24 lg:py-10`}
    >
      <div>
        <p className={`${eyebrow} mb-5 flex items-center gap-3`}>
          <Image src={claudeIcon} alt="" width={40} height={40} className="rounded-full" />
          For agents
        </p>
        <h2 className="mb-4 text-3xl leading-tight font-bold tracking-tight lg:text-4xl">
          Let an agent pay people.
          <br />
          Within caps it cannot break.
        </h2>
        <p className="mb-5 max-w-md text-base leading-6 text-zinc-600">
          Give your agent a key with a daily cap, a per-payment limit, and an allowlist. Your vault enforces
          the boundaries.
        </p>
        <div className="flex flex-wrap gap-2.5">
          <MarketingActionLink href="/create-workspace" variant="ink">
            Start building
          </MarketingActionLink>
        </div>
      </div>
      <div className="grid gap-2.5 text-sm">
        <div className="flex gap-2 rounded-xl bg-[#F4F4F5] p-3.5">
          <span className="text-zinc-500">You:</span>
          <p>Pay Dara for the studio.</p>
        </div>
        <div className="flex gap-2 rounded-xl bg-[#F4F4F5] p-3.5">
          <span className="text-[#5B4BE0]">✓</span>
          <p>Paid ₦68,816 to DARA OKONKWO via Paycrest.</p>
        </div>
        <div className="flex gap-2 rounded-xl bg-[#F4F4F5] p-3.5">
          <span className="text-zinc-500">You:</span>
          <p>Now send her ₦500,000.</p>
        </div>
        <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-amber-900">
          <span>⊘</span>
          <p>Refused by the vault. ₦500,000 is over the ₦50,000 per-payout cap.</p>
        </div>
      </div>
    </section>
  );
}

export function Trust() {
  return (
    <section id="trust" className={`${siteContainer} pb-16 lg:pb-24`}>
      <p className={`${eyebrow} mb-6`}>Why it can be trusted</p>
      <div className="grid gap-4 md:grid-cols-3">
        {trustPoints.map((point) => (
          <article key={point.title} className="min-h-[187px] rounded-[18px] border border-black/[0.06] bg-white p-6 shadow-[0_10px_30px_-20px_rgba(20,20,40,0.2)]">
            <Image
              src={point.image}
              alt=""
              width={36}
              height={36}
              className="mb-3 size-9 rounded-2xl object-contain"
            />
            <h3 className="mb-3 text-base font-semibold">{point.title}</h3>
            <p className="text-sm leading-[22px] text-zinc-600">{point.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
