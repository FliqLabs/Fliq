"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

const screens = [
  { name: "home", caption: "Meet fliq.", alt: "fliq Home: vault balance $128.18" },
  { name: "quote", caption: "Pay any bank in seconds.", alt: "Confirm: DARA OKONKWO receives ₦68,816" },
  { name: "routes", caption: "Best rate, every time.", alt: "Routes for $50: Paycrest best at ₦68,816" },
  { name: "sending", caption: "Watch it land.", alt: "Sending ₦68,816 to DARA OKONKWO" },
  { name: "paid", caption: "Proof, not promises.", alt: "Paid: ₦68,816 landed in 21 seconds" },
  { name: "agents", caption: "Only what you allow.", alt: "Agents: Claude spent ₦30,000 of ₦150,000 today" },
];

const tokens = ["usdc", "solana", "usdt", "base", "near", "tron", "ethereum", "arbitrum", "btc"];

const HOLD_MS = 3400;
const ORBIT_TILT = (-8 * Math.PI) / 180;
const ORBIT_TURNS_PER_SECOND = 0.018;

function prefersStill() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function HeroStage() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const orbit = useRef<HTMLDivElement>(null);
  const chips = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    if (paused || prefersStill()) return;
    const timer = setTimeout(() => setActive((index) => (index + 1) % screens.length), HOLD_MS);
    return () => clearTimeout(timer);
  }, [active, paused]);

  useEffect(() => {
    const still = prefersStill();
    let frame = 0;

    const place = (now: number) => {
      const width = orbit.current?.clientWidth ?? 0;
      const rx = Math.min(320, width * 0.46);
      const ry = rx * 0.31;
      const turn = still ? 0 : (now / 1000) * ORBIT_TURNS_PER_SECOND * Math.PI * 2;

      chips.current.forEach((chip, index) => {
        if (!chip) return;
        const angle = turn + (index / tokens.length) * Math.PI * 2;
        const x0 = Math.cos(angle) * rx;
        const y0 = Math.sin(angle) * ry;
        const x = x0 * Math.cos(ORBIT_TILT) - y0 * Math.sin(ORBIT_TILT);
        const y = x0 * Math.sin(ORBIT_TILT) + y0 * Math.cos(ORBIT_TILT) + 40;
        const depth = (Math.sin(angle) + 1) / 2;
        const inFront = Math.sin(angle) > 0;
        chip.style.transform = `translate(${x}px, ${y}px) scale(${0.72 + depth * 0.38})`;
        chip.style.opacity = String(inFront ? 1 : 0.35 + depth * 0.4);
        chip.style.zIndex = inFront ? "8" : "2";
      });

      if (!still) frame = requestAnimationFrame(place);
    };

    frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className="relative mx-auto flex w-full flex-col items-center py-10 lg:py-16"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="relative flex w-full justify-center">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-1/2 size-[780px] max-w-none -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,#463cff75,#7846ff33_34%,transparent_66%)] motion-safe:animate-breathe"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-1/2 h-[200px] w-[min(640px,92%)] -translate-x-1/2 -translate-y-1/2 -rotate-[8deg] rounded-[50%] border border-dashed border-[#d2c4ff1f]"
        />
        <div ref={orbit} aria-hidden="true" className="pointer-events-none absolute inset-0">
          {tokens.map((token, index) => (
            <span
              key={token}
              ref={(element) => {
                chips.current[index] = element;
              }}
              className="absolute top-1/2 left-1/2 -mt-[22px] -ml-[22px] flex size-11 items-center justify-center rounded-full border border-white/10 bg-[#111] shadow-[0_8px_24px_rgba(0,0,0,0.5),0_0_18px_rgba(113,88,255,0.18)] will-change-transform"
            >
              <Image
                src={`/landing/tokens/${token}.webp`}
                alt=""
                width={30}
                height={30}
                className="rounded-full"
              />
            </span>
          ))}
        </div>

        <div className="relative z-[5] aspect-[332/716] w-full max-w-[332px] overflow-hidden rounded-[44px] border border-[#2c2c2c] bg-[#0b0b0b] shadow-[0_0_0_8px_#0c0c0c,0_0_0_9px_#262626,0_40px_90px_rgba(0,0,0,0.7)] motion-safe:animate-float">
          {screens.map((screen, index) => (
            <Image
              key={screen.name}
              src={`/landing/screens/${screen.name}.webp`}
              alt={screen.alt}
              fill
              priority={index === 0}
              sizes="332px"
              aria-hidden={index !== active}
              className={`object-cover transition-[opacity,filter,scale] duration-700 ease-[cubic-bezier(.22,.8,.24,1)] ${
                index === active ? "scale-100 opacity-100 blur-0" : "scale-[1.04] opacity-0 blur-[14px]"
              }`}
            />
          ))}
        </div>
      </div>

      <p
        aria-live="polite"
        className="relative z-[9] mt-7 flex h-[34px] items-center rounded-full border border-white/10 bg-[#141414b8] px-3.5 text-[13px] font-medium whitespace-nowrap backdrop-blur-md"
      >
        {screens[active].caption}
      </p>
    </div>
  );
}
