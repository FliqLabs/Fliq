
import type { Metadata } from "next";
import { SiteHeader } from "../components/site-header";
import { SiteFooter } from "../components/site-footer";
import { MarketingActionLink } from "../components/marketing-action-link";
import { siteContainer } from "../components/site-container";
import { AgentsLive } from "./agents-live";

export const metadata: Metadata = {
  title: "Agents | Fliq",
  description:
    "Give AI agents a wallet with spending limits enforced by the Fliq vault on NEAR.",
};

const limits = [
  {
    number: "01",
    title: "Daily cap",
    value: "₦150,000",
    description:
      "Set the maximum an agent can spend in a day. The vault enforces the limit.",
  },
  {
    number: "02",
    title: "Per-payout cap",
    value: "₦50,000",
    description:
      "Limit the size of each individual payment, regardless of the remaining daily budget.",
  },
  {
    number: "03",
    title: "Corridors",
    value: "NGN · KES",
    description:
      "Choose the currencies an agent is allowed to use. Restrict payments to saved accounts.",
  },
  {
    number: "04",
    title: "Instant revocation",
    value: "Your call",
    description:
      "Revoke an agent's permission. The change takes effect on-chain after owner approval.",
  },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-5 text-xs font-semibold tracking-[0.16em] text-brand uppercase">
      {children}
    </p>
  );
}

function Hero() {
  return (
    <section
      className={`${siteContainer} grid gap-14 pb-20 pt-16 lg:min-h-[700px] lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-12 lg:pb-24 lg:pt-20`}
    >
      <div>
        <SectionLabel>Fliq for agents</SectionLabel>

        <h1 className="max-w-[620px] text-[clamp(42px,6vw,68px)] leading-[1.04] font-bold tracking-[-0.055em] text-white">
          Give your agent a wallet with{" "}
          <span className="text-zinc-500">limits it cannot break.</span>
        </h1>

        <p className="mt-7 max-w-[490px] text-base leading-7 text-zinc-400 sm:text-lg">
          Let AI agents make payments on your behalf without handing over
          unlimited control. Set the rules. Keep the authority.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <MarketingActionLink href="#setup">
            Add the MCP server <span className="ml-2">↗</span>
          </MarketingActionLink>
          <MarketingActionLink href="#agent-key" variant="secondary">
            Make an agent key
          </MarketingActionLink>
        </div>

        <div className="mt-9 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
          <span className="rounded-full border border-[#333] px-3 py-1.5">
            Built on NEAR
          </span>
          <span className="rounded-full border border-[#333] px-3 py-1.5">
            On-chain spending limits
          </span>
          <span className="rounded-full border border-[#333] px-3 py-1.5">
            MCP compatible
          </span>
        </div>
      </div>

      <AgentsLive />
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
          Every agent operates within rules you define. Spending limits are
          enforced by the Fliq vault on NEAR.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {limits.map((limit) => (
          <article
            key={limit.number}
            className="group rounded-[18px] border border-[#2c2c2c] bg-[#151515] p-5 transition-colors hover:border-[#51477a]"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-zinc-600">
                {limit.number}
              </span>
              <span className="size-1.5 rounded-full bg-brand/70" />
            </div>
            <h3 className="mt-8 text-sm font-medium text-zinc-400">
              {limit.title}
            </h3>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-white">
              {limit.value}
            </p>
            <p className="mt-4 text-sm leading-[22px] text-zinc-500">
              {limit.description}
            </p>
          </article>
        ))}
      </div>
      <p className="mt-4 text-xs leading-5 text-zinc-600">
        Saved-account restrictions are enforced by the API. Spending caps and
        permitted currencies are part of the agent policy enforced by the vault.
      </p>
    </section>
  );
}

function McpSetup() {
  return (
    <section
      id="setup"
      className={`${siteContainer} scroll-mt-24 pb-24`}
    >
              <div className="grid gap-10 rounded-[22px] border border-[#303030] bg-[#151515] p-6 sm:p-9 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-16">
      <div>
        <SectionLabel>Connect your agent</SectionLabel>
        <h2 className="text-3xl leading-tight font-bold tracking-tight text-white sm:text-4xl">
          Your agent already knows how to use tools.
          <span className="text-zinc-500"> Give it Fliq.</span>
        </h2>
        <p className="mt-5 text-sm leading-6 text-zinc-400">
          Fliq's MCP server gives compatible AI clients tools to quote
          cash-outs, verify bank accounts, create payments and track their
          status.
        </p>

        <ul className="mt-6 space-y-3 text-sm text-zinc-300">
          {[
            "Get a Fliq workspace API key.",
            "Add the MCP server to your client.",
            "Configure your agent's own NEAR key when using vault-agent features.",
          ].map((item) => (
            <li key={item} className="flex gap-3">
              <span className="text-brand">✓</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="min-w-0 overflow-hidden rounded-xl border border-[#303030] bg-[#0b0b0b]">
        <div className="flex items-center justify-between border-b border-[#292929] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-brand" />
            <span className="text-xs font-medium text-zinc-300">
              Claude Code · MCP config
            </span>
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
            Replace the placeholder with your own workspace API key.
          </p>
        </div>
      </div>
    </div>

    <div
      id="agent-key"
      className="mt-5 scroll-mt-24 rounded-xl border border-[#2c2c2c] bg-[#111] p-5 sm:p-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">
            About agent keys
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
            An agent key is a separate NEAR Ed25519 signing key, not your
            ordinary Fliq API key. Registering an agent and changing its
            permissions require owner approval through the supported signing
            flow.
          </p>
        </div>
        <span className="w-fit shrink-0 rounded-full border border-amber-900/60 bg-amber-950/30 px-3 py-1.5 text-xs text-amber-400">
          Web setup not available yet
        </span>
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
          Start with the Fliq MCP server and define the boundaries before
          your agent moves money.
        </p>
        <div className="mt-8 flex justify-center">
          <MarketingActionLink href="#setup">
            Explore MCP setup
          </MarketingActionLink>
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
