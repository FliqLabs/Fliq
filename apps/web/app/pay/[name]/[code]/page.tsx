import type { Metadata } from "next";
import { Suspense } from "react";
import { SiteFooter } from "../../../components/site-footer";
import { SiteHeader } from "../../../components/site-header";
import { siteContainer } from "../../../components/site-container";
import { PayRequestClient } from "./pay-request-client";

const API_BASE = process.env.FLIQ_API_BASE_URL ?? "https://api-production-54e10.up.railway.app/v1";

type PageProps = { params: Promise<{ name: string; code: string }> };

/* The link is shared in chats, so its preview names who is asking and how much. A request the API cannot find
   still gets a plain title instead of failing the page. */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { name, code } = await params;
  try {
    const response = await fetch(`${API_BASE}/pay/${encodeURIComponent(name)}/${encodeURIComponent(code)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { title: "Payment request | fliq" };
    const request = (await response.json()) as { display_name: string | null; amount: string; note: string };
    const who = request.display_name ?? name;
    const title = `${who} requested $${request.amount} on fliq`;
    return {
      title,
      description: request.note || "Pay in seconds with fliq or from any wallet.",
      openGraph: { title, description: request.note || "Pay in seconds with fliq or from any wallet." },
    };
  } catch {
    return { title: "Payment request | fliq" };
  }
}

export default function PayRequestPage({ params }: PageProps) {
  return (
    <div className="flex min-h-screen flex-col bg-[#0b0b0b] text-white">
      <SiteHeader />
      <main className={`${siteContainer} flex-1 pb-20 pt-28`}>
        <Suspense fallback={<p className="text-center text-sm text-[#999]">Loading the request…</p>}>
          <PayRequest params={params} />
        </Suspense>
      </main>
      <SiteFooter />
    </div>
  );
}

async function PayRequest({ params }: PageProps) {
  const { name, code } = await params;
  return <PayRequestClient name={name} code={code} />;
}
