import type { Metadata } from "next";
import Image from "next/image";
import { Inter, Outfit } from "next/font/google";
import { PricingCards } from "./pricing-cards";
import { SiteHeader } from "../components/site-header";
import { SiteFooter } from "../components/site-footer";
import { siteContainer } from "../components/site-container";
import workedExampleIcon from "./Mask group.png";

const inter = Inter({ subsets: ["latin"] });
const outfit = Outfit({ subsets: ["latin"], weight: "700" });

export const metadata: Metadata = {
  title: "Pricing | Fliq",
  description: "Free to build. Pay when it moves money. Explore Fliq’s Sandbox, Build, and Scale plans.",
};

export default function PricingPage() {
  return (
    <div className={`${inter.className} min-h-screen bg-[#161616] text-white`}>
      <SiteHeader activeHref="/pricing" brandClassName={outfit.className} />
      <main className={`${siteContainer} pt-[120px] pb-[72px] sm:pt-[125px]`}>
        <section aria-labelledby="pricing-heading">
          <div className="text-center">
            <h1 id="pricing-heading" className="text-[clamp(34px,4vw,52px)] leading-[1.2] font-bold tracking-[-0.035em]">
              Free to build. Pay when it moves money.
            </h1>
            <p className="mx-auto mt-5 max-w-[600px] text-[17px] leading-[25px] text-[#a3a3a3]">
              The rate you see is the rate the user gets. Our fee sits inside the provider spread and is printed on every quote.
            </p>
          </div>
          <PricingCards />
        </section>
        <aside aria-label="Worked fee example" className="mt-10 border border-[#2c2c2c] p-6 lg:-mx-6">
          <Image src={workedExampleIcon} alt="Nigeria" className="h-[22px] w-auto" />
          <p className="mt-4 text-sm leading-[21px] text-[#a3a3a3]">
            Worked example: $50 at ₦1,383.20 provider rate, fees ₦344 (Paycrest ₦250, network ₦94), lands as ₦68,816. The fliq&apos;s share is inside the ₦344 and shown on the quote.
          </p>
        </aside>
      </main>
      <SiteFooter />
    </div>
  );
}
