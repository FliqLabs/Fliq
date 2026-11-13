import Image from "next/image";
import type { Metadata } from "next";
import Link from "next/link";
import { MarketingActionLink } from "../components/marketing-action-link";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import { siteContainer } from "../components/site-container";
import { AgentsLive } from "./agents-live";

export const metadata: Metadata = {
  title: "Agents | Fliq",
  description: "Give AI agents a wallet with spending limits enforced by the Fliq vault on NEAR.",
};

const limits = [
  {
    number: "01",
    title: "Daily cap",
    value: "₦150,000",
    description: "Example policy only. Set the maximum an agent can spend in a day.",
  },
  {
    number: "02",
    title: "Per-payout cap",
    value: "₦50,000",
    description: "Example policy only. Limit the size of each individual payment.",
  },
  {
    number: "03",
    title: "Corridors",
    value: "NGN only",
    description: "Example policy only. Choose the currencies and accounts an agent may use.",
  },
  {
    number: "04",
    title: "Revoke",
    value: "Owner approval",
    description: "The owner signs policy changes before they take effect on chain.",
  },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-5 text-xs font-semibold tracking-[0.16em] text-brand uppercase">{children}</p>;
}

function AgentIconCluster() {
  return (
    <div className="mb-8 flex items-center justify-center gap-2.5" aria-hidden="true">
      <span className="grid size-14 place-items-center rounded-xl bg-black ring-1 ring-white/5">
        <Image src="/app/mark.webp" alt="" width={48} height={48} className="size-12" />
      </span>
      <span className="grid size-12 place-items-center rounded-full bg-[#161616] ring-1 ring-white/5">
        <Image src="/app/claude.webp" alt="" width={34} height={34} className="size-8" />
      </span>
      <span className="grid size-14 place-items-center rounded-xl bg-black ring-1 ring-white/5">
        <Image src="/app/mark.webp" alt="" width={48} height={48} className="size-12" />
      </span>
    </div>
  );
}

function Hero() {
  return (
    <section className={`${siteContainer} pb-20 pt-28 text-center sm:pb-24 sm:pt-36`}>
      <AgentIconCluster />
      <h1 className="mx-auto max-w-[760px] text-[clamp(42px,6vw,68px)] leading-[1.02] font-bold tracking-[-0.055em] text-white">
        Give your agent a wallet
        <br className="hidden sm:block" /> <span className="text-zinc-500">with limits it cannot break.</span>
      </h1>
      <p className="mx-auto mt-7 max-w-[680px] text-base leading-7 text-zinc-400 sm:text-lg">
        An agent key is a NEAR function-call key on your vault. The contract checks every payout against the
        caps you set. No server in the middle, nothing to trust.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <MarketingActionLink href="#setup">Add the MCP server</MarketingActionLink>
        <MarketingActionLink href="/wallet/agents" variant="secondary">
          Make an agent key
        </MarketingActionLink>
      </div>
    </section>
  );
}

function Limits() {
  return (
    <section className={`${siteContainer} pb-24`}>
      <div className="mb-9 max-w-xl">
        <SectionLabel>Control the wallet</SectionLabel>
        <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Permission to pay.
          <br />
          Not permission to do anything.
        </h2>
        <p className="mt-4 text-sm leading-6 text-zinc-400">
          Every agent operates within rules you define. Spending limits are enforced by the Fliq vault on
          NEAR.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {limits.map((limit) => (
          <article
            key={limit.number}
            className="group rounded-[18px] border border-[#2c2c2c] bg-[#151515] p-5 transition-colors hover:border-[#51477a]"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-zinc-600">{limit.number}</span>
              <span className="rounded-full border border-brand/30 px-2 py-1 text-[10px] text-brand">
                Example
              </span>
            </div>
            <h3 className="mt-8 text-sm font-medium text-zinc-400">{limit.title}</h3>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-white">{limit.value}</p>
            <p className="mt-4 text-sm leading-[22px] text-zinc-500">{limit.description}</p>
          </article>
        ))}
      </div>
      <p className="mt-4 text-xs leading-5 text-zinc-600">
        The values above are illustrative examples, not your connected agent&apos;s actual limits.
        Saved-account restrictions are enforced by the API; spending caps and permitted currencies are part of
        the agent policy.
      </p>
    </section>
  );
}

function McpSetup() {
  return (
    <section id="setup" className={`${siteContainer} scroll-mt-24 pb-24`}>
      <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-start lg:gap-10">
        <div>
          <SectionLabel>One config</SectionLabel>
          <div className="overflow-hidden rounded-xl border border-[#303030] bg-[#0b0b0b]">
            <div className="flex items-center justify-between border-b border-[#292929] px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-brand" />
                <span className="text-xs font-medium text-zinc-300">Claude Code · MCP config</span>
              </div>
              <span className="text-[10px] text-zinc-600">JSON</span>
            </div>
            <pre className="overflow-x-auto p-5 text-xs leading-[22px] text-zinc-300">
              <code>{`{
  "mcpServers": {
    "fliq": {
      "command": "npx",
      "args": ["-y", "@fliq/mcp"],
      "env": {
        "FLIQ_API_KEY": "rt_test_..."
      }
    }
  }
}`}</code>
            </pre>
            <div className="border-t border-[#292929] px-5 py-3">
              <p className="text-xs text-zinc-600">
                Configuration example. Replace the placeholder with your own workspace API key.
              </p>
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-zinc-500">
            The MCP server provides tools to quote cash-outs, verify accounts, create payments and track
            status. It is configured in your MCP client; this page does not install it automatically.
          </p>
        </div>

        <div>
          <SectionLabel>What the user sees in the app</SectionLabel>
          <AgentsLive />
        </div>
      </div>

      <div id="agent-key" className="mt-10 rounded-xl border border-[#2c2c2c] bg-[#111] p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">Connect an agent key</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
              Connect an agent and set its limits in the authenticated wallet. Your browser signs the vault
              policy change after you approve it.
            </p>
          </div>
          <Link
            href="/wallet/agents"
            className="inline-flex w-fit shrink-0 items-center rounded-xl border border-zinc-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:border-white"
          >
            Open agent settings
          </Link>
        </div>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section className={`${siteContainer} pb-24`}>
      <div className="rounded-[22px] border border-[#353044] bg-[radial-gradient(ellipse_at_top_left,#29213d_0%,#17151d_42%,#111_100%)] px-6 py-12 text-center sm:px-12 sm:py-16">
        <SectionLabel>Built for autonomous workflows</SectionLabel>
        <h2 className="mx-auto max-w-2xl text-3xl leading-tight font-bold tracking-tight text-white sm:text-5xl">
          Give your agent room to work.
          <br />
          Keep control of the limits.
        </h2>
        <p className="mx-auto mt-5 max-w-lg text-sm leading-6 text-zinc-400">
          Start with the Fliq MCP server and define the boundaries before your agent moves money.
        </p>
        <div className="mt-8 flex justify-center">
          <MarketingActionLink href="#setup">Explore MCP setup</MarketingActionLink>
        </div>
      </div>
    </section>
  );
}

export default function AgentsPage() {
  return (
    <div className="min-h-screen overflow-x-clip bg-[#0b0b0b] text-white">
      <SiteHeader activeHref="/agents" />
      <main className="pt-[68px]">
        <Hero />
        <Limits />
        <McpSetup />
        <Closing />
      </main>
      <SiteFooter />
    </div>
  );
}
