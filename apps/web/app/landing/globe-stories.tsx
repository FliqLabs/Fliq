"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { glyphKey } from "./globe-tiles";
import { TileGlobe, type Spotlight } from "./tile-globe";

type Visual = "payout" | "deposit" | "rate" | "agent";

const stories: { key: string; label: string; title: string; detail: string; visual: Visual }[] = [
  {
    key: "/landing/icons/flags/ng.svg",
    label: "Payout",
    title: "₦68,816 landed at GTBank",
    detail: "DARA OKONKWO, via Paycrest",
    visual: "payout",
  },
  {
    key: "/landing/icons/tokens/sol.svg",
    label: "Deposit",
    title: "+$199.98 from Solana",
    detail: "200 USDC in, landed in 34 seconds",
    visual: "deposit",
  },
  {
    key: "/landing/icons/tokens/usdc.svg",
    label: "Rate",
    title: "₦1,376.32 per $1",
    detail: "Best of 4 providers, after fees",
    visual: "rate",
  },
  {
    key: glyphKey("₦", "violet"),
    label: "Agent",
    title: "Claude paid ₦30,000",
    detail: "Inside its ₦150,000 daily cap",
    visual: "agent",
  },
];

const storyKeys = stories.map((story) => story.key);

function useStoryClock(key: string) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const next = (now - start) / 1000;
      setSeconds(next);
      if (next < 3) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [key]);
  return seconds;
}

const ease = (value: number) => 1 - (1 - Math.min(1, Math.max(0, value))) ** 3;

function Bar({ fill }: { fill: number }) {
  return (
    <span className="block h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
      <span className="block h-full rounded-full bg-[#a594ff]" style={{ width: `${fill * 100}%` }} />
    </span>
  );
}

function StoryVisual({ visual, seconds }: { visual: Visual; seconds: number }) {
  if (visual === "payout") {
    return (
      <div>
        <div className="flex gap-1">
          {[0, 1, 2].map((step) => (
            <Bar key={step} fill={ease((seconds - step * 0.7) / 0.7)} />
          ))}
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] text-zinc-500">
          <span>Quote</span>
          <span>Route</span>
          <span className="tabular-nums text-zinc-300">Paid in {Math.round(ease(seconds / 2.1) * 21)}s</span>
        </div>
      </div>
    );
  }
  if (visual === "deposit") {
    const progress = ease(seconds / 1.8);
    return (
      <div className="flex items-center gap-3">
        <Bar fill={progress} />
        <span className="text-[13px] font-semibold text-white tabular-nums">
          ${(199.98 * progress).toFixed(2)}
        </span>
      </div>
    );
  }
  if (visual === "rate") {
    const draw = ease(seconds / 1.6);
    return (
      <div className="flex items-end gap-3">
        <svg viewBox="0 0 120 32" className="h-8 flex-1" aria-hidden="true">
          <polyline
            points="2,28 60,18 118,4"
            fill="none"
            stroke="#a594ff"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray="1"
            strokeDashoffset={1 - draw}
          />
          <circle cx="118" cy="4" r="3" fill="#a594ff" opacity={draw} />
        </svg>
        <span className="text-[10px] text-zinc-500 tabular-nums">1,375.90 → 1,376.32</span>
      </div>
    );
  }
  return (
    <div>
      <Bar fill={ease(seconds / 1.4) * 0.2} />
      <div className="mt-1.5 flex justify-between text-[10px] text-zinc-500 tabular-nums">
        <span>₦30,000 used</span>
        <span>₦150,000 a day</span>
      </div>
    </div>
  );
}

function StoryCard({ index }: { index: number }) {
  const story = stories[index];
  const seconds = useStoryClock(story.key);
  return (
    <div className="w-[268px] rounded-2xl border border-white/10 bg-[#111114]/95 p-3.5 font-sans shadow-[0_20px_50px_rgba(0,0,0,0.55)] backdrop-blur-md">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-medium tracking-[0.08em] text-[#a594ff] uppercase">
          <span className="size-1.5 animate-pulse rounded-full bg-[#a594ff]" />
          {story.label}
        </span>
        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-zinc-400">Sample</span>
      </div>
      <p className="mt-2 text-[15px] leading-tight font-semibold tracking-[-0.02em] text-white">
        {story.title}
      </p>
      <p className="mt-1 text-[12px] text-zinc-400">{story.detail}</p>
      <div className="mt-3">
        <StoryVisual visual={story.visual} seconds={seconds} />
      </div>
    </div>
  );
}

export function StoryGlobe({ font }: { font: string }) {
  const anchor = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);

  const onSpotlight = useCallback((spotlight: Spotlight | null) => {
    if (!spotlight) {
      setActive(null);
      return;
    }
    const index = storyKeys.indexOf(spotlight.key);
    setActive(index);
    const { x, y, strength } = spotlight;
    if (anchor.current) {
      anchor.current.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${0.8 + 0.2 * strength})`;
      anchor.current.style.opacity = String(strength);
    }
    const element = card.current;
    const layer = element?.parentElement;
    if (element && layer) {
      const above = y < layer.clientHeight / 2;
      const left = Math.min(
        Math.max(16, x - element.offsetWidth / 2),
        layer.clientWidth - element.offsetWidth - 16,
      );
      const top = Math.min(
        Math.max(84, above ? y - 64 - element.offsetHeight : y + 64),
        layer.clientHeight - element.offsetHeight - 16,
      );
      const drift = (above ? 1 : -1) * 14 * (1 - strength);
      element.style.transform = `translate(${left}px, ${top + drift}px)`;
      element.style.opacity = String(strength);
    }
  }, []);

  return (
    <>
      <TileGlobe font={font} stories={storyKeys} onSpotlight={onSpotlight} />
      <div
        data-stories
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[2] hidden sm:block"
      >
        <div
          ref={anchor}
          style={{ opacity: 0 }}
          className="absolute top-0 left-0 size-[96px] rounded-[26px] shadow-[0_0_0_2px_#a594ff,0_0_40px_8px_rgba(165,148,255,0.45)]"
        />
        <div ref={card} style={{ opacity: 0 }} className="absolute top-0 left-0">
          {active !== null && <StoryCard key={active} index={active} />}
        </div>
      </div>
    </>
  );
}
