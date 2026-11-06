import type { Metadata } from "next";
import { MarketingShell } from "../components/marketing-shell";
import WaitlistForm from "./waitlist-form";

export const metadata: Metadata = {
  title: "Join the waitlist | fliq",
  description: "Get early updates from fliq. Global crypto. Local money.",
};

const container = "mx-auto w-full max-w-[1280px] px-5 sm:px-10";
const smallLabel = "font-mono text-[11px] font-medium tracking-[0.08em]";

const steps = [
  {
    number: "01",
    title: "Leave your email.",
    description: "One field is all it takes to join the list.",
  },
  {
    number: "02",
    title: "Stay in the loop.",
    description: "We’ll share news as fliq gets closer to launch.",
  },
  {
    number: "03",
    title: "Move with fliq.",
    description: "Be among the first to hear when access opens.",
  },
];

function HeroCopy() {
  return (
    <div className="max-w-[560px]">
      <p className={`${smallLabel} mb-8 text-zinc-400`}>[ FLIQ ] &nbsp; [ THE WAITLIST ]</p>
      <h1
        id="waitlist-heading"
        className="mb-8 w-fit text-[clamp(52px,13vw,104px)] leading-[0.98] font-semibold tracking-[-0.075em]"
      >
        Get there
        {/* <br /> */}
        <span className="ml-4 md:ml-0 mt-2.5 inline-block bg-[#f3f3f1] px-[0.13em] pb-[0.1em] text-zinc-950">
          early.
        </span>
      </h1>
      <p className="mb-3 text-lg font-semibold tracking-tight sm:text-xl">Global crypto. Local money.</p>
      <p className="max-w-[460px] text-[15px] leading-relaxed text-zinc-400 sm:text-[17px]">
        A better way to move from stablecoins to money you can use is on its way. Join the list and follow
        what comes next.
      </p>
      <p className={`${smallLabel} mt-9 flex items-center gap-2.5 text-zinc-500`}>
        <span className="size-[7px] bg-brand" />
        ONE EMAIL. YOU’RE IN.
      </p>
    </div>
  );
}

function SignupCard() {
  return (
    <div className="border border-zinc-700 bg-surface shadow-[12px_12px_0_#090909]">
      <div
        className={`${smallLabel} flex min-h-[78px] items-center justify-between border-b border-dashed border-zinc-700 px-7 text-zinc-400`}
      >
        <span>YOUR PLACE STARTS HERE</span>
        <span aria-hidden="true" className="font-sans text-3xl leading-none text-[#ddd5ff]">
          ✳
        </span>
      </div>
      <div className="px-5 pt-8 pb-7 sm:px-7">
        <p className={`${smallLabel} mb-3.5 text-brand`}>01 / EARLY ACCESS</p>
        <h2 className="mb-3 text-[30px] leading-tight font-semibold tracking-tight">Join the waitlist.</h2>
        <p className="mb-7 text-[15px] leading-relaxed text-zinc-400">
          Be first to hear when fliq is ready. All we need is your email.
        </p>
        <WaitlistForm />
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section
      aria-labelledby="waitlist-heading"
      className="relative isolate overflow-hidden border-b border-zinc-800 bg-[linear-gradient(#ffffff08_1px,transparent_1px),linear-gradient(90deg,#ffffff08_1px,transparent_1px)] bg-[size:80px_80px]"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-72 -right-48 -z-10 size-[680px] rounded-full bg-[radial-gradient(circle,#7761ff38,transparent_68%)]"
      />
      <div
        className={`${container} grid min-h-[680px] items-center gap-14 py-20 md:grid-cols-[minmax(0,1fr)_minmax(350px,470px)] md:gap-9 lg:gap-20 lg:py-24`}
      >
        <HeroCopy />
        <SignupCard />
      </div>
    </section>
  );
}

function NextSteps() {
  return (
    <section className={`${container} py-16 lg:py-20`} aria-labelledby="steps-heading">
      <div className={`${smallLabel} mb-5 flex flex-wrap justify-between gap-3 text-zinc-400`}>
        <h2 id="steps-heading">[ WHAT HAPPENS NEXT ]</h2>
        <span>THE SHORT VERSION — 001</span>
      </div>
      <div className="grid border-y border-zinc-700 md:grid-cols-3">
        {steps.map((step) => (
          <article
            key={step.number}
            className="border-b border-zinc-700 py-7 last:border-b-0 md:min-h-[200px] md:border-r md:border-b-0 md:px-8 md:first:pl-0 md:last:border-r-0"
          >
            <p className={`${smallLabel} mb-8 text-brand`}>{step.number} / FLIQ</p>
            <h3 className="mb-3 text-xl font-semibold tracking-tight">{step.title}</h3>
            <p className="max-w-[290px] text-sm leading-relaxed text-zinc-400">{step.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function JoinWaitlistPage() {
  return (
    <MarketingShell>
      <div className="bg-canvas font-sans">
        <main id="main-content">
          <Hero />
          <NextSteps />
        </main>
      </div>
    </MarketingShell>
  );
}
