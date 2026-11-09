"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { MarketingActionLink } from "../components/marketing-action-link";

const CARD_MAX_WIDTH = 1136;
const CARD_HEIGHT = 440;
const CARD_RADIUS = 26;
const HEADER_HEIGHT = 68;

type Star = { x: number; y: number; r: number; phase: number };
type Building = { x: number; w: number; h: number; lit: boolean[] };

function seededRandom(seed: number) {
  let value = seed;
  return () => (value = (value * 16807) % 2147483647) / 2147483647;
}

function buildSky(width: number, height: number) {
  const random = seededRandom(7);
  const stars: Star[] = Array.from({ length: Math.round(width / 6) }, () => ({
    x: random() * width,
    y: random() * height * 0.62,
    r: random() * 1.1 + 0.2,
    phase: random() * Math.PI * 2,
  }));
  const skyline: Building[] = [];
  for (let x = 0; x < width; ) {
    const w = 14 + random() * 46;
    const h = 18 + random() * (random() > 0.85 ? 90 : 46);
    skyline.push({ x, w, h, lit: Array.from({ length: 4 }, () => random() > 0.6) });
    x += w + random() * 4;
  }
  return { stars, skyline };
}

function paintSky(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  sky: ReturnType<typeof buildSky>,
  seconds: number,
) {
  context.clearRect(0, 0, width, height);
  const horizon = context.createRadialGradient(
    width / 2,
    height * 1.05,
    10,
    width / 2,
    height * 1.05,
    width * 0.75,
  );
  horizon.addColorStop(0, "rgba(120,96,255,0.95)");
  horizon.addColorStop(0.32, "rgba(70,52,210,0.55)");
  horizon.addColorStop(0.7, "rgba(30,24,90,0.18)");
  horizon.addColorStop(1, "rgba(5,4,12,0)");
  context.fillStyle = horizon;
  context.fillRect(0, 0, width, height);

  context.fillStyle = "#fff";
  for (const star of sky.stars) {
    context.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(seconds * 0.8 + star.phase));
    context.beginPath();
    context.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;

  for (const building of sky.skyline) {
    context.fillStyle = "#100c2a";
    context.fillRect(building.x, height - building.h, building.w, building.h);
    context.fillStyle = "rgba(190,176,255,0.55)";
    building.lit.forEach((on, index) => {
      if (!on) return;
      const column = (index % 2) * (building.w / 2);
      const row = Math.floor(index / 2) * 10;
      context.fillRect(building.x + 4 + column, height - building.h + 8 + row, 2, 3);
    });
  }
}

export function Finale() {
  const card = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;

    let sky = buildSky(1, 1);
    let frame = 0;
    let visible = false;

    const resize = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      element.width = element.clientWidth * ratio;
      element.height = element.clientHeight * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      sky = buildSky(element.clientWidth, element.clientHeight);
    };

    const grow = () => {
      if (!card.current) return;
      const viewport = document.documentElement.clientWidth;
      const screen = window.innerHeight - HEADER_HEIGHT;
      const startWidth = Math.min(CARD_MAX_WIDTH, viewport - 40);
      const top = card.current.getBoundingClientRect().top;
      const progress = still ? 1 : Math.min(1, Math.max(0, (window.innerHeight - top) / screen));
      const eased = 1 - Math.pow(1 - progress, 3);
      card.current.style.width = `${startWidth + (viewport - startWidth) * eased}px`;
      card.current.style.height = `${CARD_HEIGHT + (screen - CARD_HEIGHT) * eased}px`;
      card.current.style.borderRadius = `${CARD_RADIUS * (1 - eased)}px`;
      if (Math.abs(element.clientWidth * Math.min(2, window.devicePixelRatio || 1) - element.width) > 2)
        resize();
    };

    const paint = (now: number) => {
      paintSky(context, element.clientWidth, element.clientHeight, sky, still ? 0 : now / 1000);
      if (visible && !still) frame = requestAnimationFrame(paint);
    };

    const watcher = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      cancelAnimationFrame(frame);
      if (visible) frame = requestAnimationFrame(paint);
    });

    resize();
    grow();
    paint(0);
    watcher.observe(element);
    window.addEventListener("scroll", grow, { passive: true });
    window.addEventListener("resize", grow);
    return () => {
      cancelAnimationFrame(frame);
      watcher.disconnect();
      window.removeEventListener("scroll", grow);
      window.removeEventListener("resize", grow);
    };
  }, []);

  return (
    <section id="sandbox" className="relative mt-8 flex justify-center">
      <div
        ref={card}
        className="relative flex h-[440px] w-[min(1136px,calc(100vw-40px))] max-w-none shrink-0 items-center justify-center overflow-hidden rounded-[26px] border border-[#1d1a33] bg-[#05040c] text-center"
      >
        <canvas ref={canvas} aria-hidden="true" className="absolute inset-0 size-full" />
        <div className="relative z-10 flex flex-col items-center gap-4 px-6 pt-14 pb-28">
          <Image
            src="/landing/mark.webp"
            alt=""
            width={88}
            height={88}
            className="rounded-[22px] shadow-[0_0_40px_rgba(113,88,255,0.45)]"
          />
          <p className="text-[clamp(56px,9vw,96px)] leading-none font-bold tracking-[-0.04em]">fliq</p>
          <p className="text-[17px] text-[#cfcaf0]">
            <strong className="font-semibold text-white">Global crypto.</strong> Local money.
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight">Start in sandbox. Nothing real moves.</h2>
          <p className="max-w-[440px] text-sm leading-6 text-[#9d97c7]">
            A test key, a demo recipient, and a payout you can follow all the way.
          </p>
          <div className="mt-1 flex flex-wrap justify-center gap-2.5">
            <MarketingActionLink href="/create-workspace">Start in sandbox</MarketingActionLink>
          </div>
        </div>
      </div>
    </section>
  );
}
