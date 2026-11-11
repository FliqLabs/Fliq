import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ComponentType } from "react";
import { docsPages } from "../navigation";
import Quickstart from "../content/quickstart";
import Api from "../content/api";
import Authentication from "../content/authentication";
import Quotes from "../content/quotes";
import Payouts from "../content/payouts";
import Verification from "../content/account-verification";
import Institutions from "../content/institutions";
import Webhooks from "../content/webhooks";
import Rates from "../content/rates";
import Agents from "../content/agents";
import Vault from "../content/vault-contract";
import Errors from "../content/errors";
import Sandbox from "../content/sandbox";
import Sdk from "../content/sdk";

const articles: Record<string, ComponentType> = {
  quickstart: Quickstart,
  api: Api,
  authentication: Authentication,
  quotes: Quotes,
  payouts: Payouts,
  "account-verification": Verification,
  institutions: Institutions,
  webhooks: Webhooks,
  rates: Rates,
  agents: Agents,
  "vault-contract": Vault,
  errors: Errors,
  sandbox: Sandbox,
  sdk: Sdk,
};

export function generateStaticParams() {
  return docsPages.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = docsPages.find((page) => page.slug === slug);
  return { title: `${page?.title ?? "Documentation"} | Fliq Docs` };
}

export default function DocsArticle({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense
      fallback={
        <main id="docs-content" className="docs-article" aria-busy="true">
          <p role="status" className="text-[13px] text-zinc-500">
            Loading documentation…
          </p>
        </main>
      }
    >
      <ResolvedDocsArticle params={params} />
    </Suspense>
  );
}

async function ResolvedDocsArticle({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const index = docsPages.findIndex((page) => page.slug === slug);
  if (index === -1) notFound();
  const Article = articles[slug];
  const previous = docsPages[index - 1];
  const next = docsPages[index + 1];

  return (
    <main id="docs-content" className="docs-article">
      {slug !== "api" && (
        <aside className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] leading-5 text-amber-900">
          Sandbox documentation preview. Some features shown in the product design are still being
          implemented. Use the{" "}
          <Link href="/docs/api" className="font-semibold underline">
            current API contract
          </Link>{" "}
          for request schemas and endpoint availability.
        </aside>
      )}
      <Article />
      <nav
        aria-label="Previous and next article"
        className="mt-4 grid grid-cols-2 gap-4 border-t border-[#e6e6e6] pt-6 text-[13px]"
      >
        <div>
          {previous && (
            <Link href={`/docs/${previous.slug}`} className="block rounded-xl border border-[#e6e6e6] p-4">
              <span className="block text-[11px] text-zinc-500">Previous</span>
              <span className="mt-1 block font-semibold">← {previous.title}</span>
            </Link>
          )}
        </div>
        <div>
          {next && (
            <Link
              href={`/docs/${next.slug}`}
              className="block rounded-xl border border-[#e6e6e6] p-4 text-right"
            >
              <span className="block text-[11px] text-zinc-500">Next</span>
              <span className="mt-1 block font-semibold">{next.title} →</span>
            </Link>
          )}
        </div>
      </nav>
    </main>
  );
}
