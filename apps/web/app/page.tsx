import { MarketingShell } from "./components/marketing-shell";
import { Finale } from "./landing/finale";
import { GlobeHero } from "./landing/globe-hero";
import { Agents, Developers, HowItWorks, Trust } from "./landing/sections";

export default function HomePage() {
  return (
    <MarketingShell>
      <div className="flow-root overflow-x-clip bg-[linear-gradient(180deg,#17191d_0%,#171717_30%,#0b0b0b_70%,#000_100%)]">
        <main>
          <GlobeHero />
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
