"use client";

import Link from "next/link";
import localFont from "next/font/local";
import { useEffect, useRef, useState } from "react";
import { PhotoGlobe } from "./photo-globe";

const display = localFont({
  src: "./fonts/montserrat-display.woff2",
  weight: "400 900",
  display: "swap",
});

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function useScrollFade(section: React.RefObject<HTMLElement | null>, disabled: boolean) {
  useEffect(() => {
    const host = section.current;
    if (!host || disabled) {
      host?.style.setProperty("--fade", "0");
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const progress = Math.max(0, Math.min(1, window.scrollY / Math.max(1, host.offsetHeight * 0.6)));
      host.style.setProperty("--fade", progress.toFixed(3));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
    };
  }, [section, disabled]);
}

export function GlobeHero() {
  const section = useRef<HTMLElement>(null);
  const reducedMotion = useReducedMotion();
  useScrollFade(section, reducedMotion);

  return (
    <section
      ref={section}
      aria-labelledby="hero-title"
      className={`${display.className} relative h-[100svh] min-h-[610px] overflow-hidden [--fade:0]`}
    >
      <div className="absolute inset-0 origin-center [opacity:calc(1-var(--fade)*0.6)] [transform:scale(calc(1-var(--fade)*0.18))] will-change-transform">
        <PhotoGlobe reducedMotion={reducedMotion} />
      </div>
      <div
        className={`relative z-[3] flex h-full flex-col items-center justify-center px-5 pt-[65px] pb-20 text-center text-[#fafaf7] [opacity:calc(1-var(--fade)*1.6)] [transform:translateY(calc(var(--fade)*-22px))] sm:px-6 sm:pb-[30px]`}
      >
        <h1
          id="hero-title"
          className="m-0 max-w-[750px] text-[clamp(27px,7.9vw,59px)] leading-[0.98] font-black tracking-[-0.063em] uppercase sm:text-[clamp(42px,4.8vw,78px)] sm:leading-[0.96] sm:tracking-[-0.06em]"
        >
          <span className="block">Dollars in,</span>
          <span className="block">your bank</span>
          <span className="block">account out.</span>
        </h1>
        <p className="mx-0 mt-[22px] mb-[23px] max-w-[min(74vw,270px)] text-xs leading-[1.6] font-normal tracking-[-0.035em] text-balance sm:mt-6 sm:mb-[26px] sm:max-w-[430px] sm:text-[clamp(13px,1.28vw,18px)] sm:leading-normal">
          Any chain in. Any bank or mobile money out. Live now at ₦1,376.32 per $1 after fees.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          <Link
            href="/create-workspace"
            className="inline-flex h-11 items-center gap-[9px] rounded-full bg-white px-[18px] text-sm font-semibold tracking-[-0.02em] text-black transition-transform duration-[280ms] ease-[cubic-bezier(.34,1.56,.64,1)] hover:scale-[1.04] active:scale-[0.96] active:duration-[170ms] sm:h-12 sm:px-5 sm:text-base motion-reduce:transform-none"
          >
            Get started
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M7 17 17 7M7 7h10v10" />
            </svg>
          </Link>
          <Link
            href="/rates"
            className="inline-flex h-11 items-center rounded-full px-[18px] text-sm font-semibold tracking-[-0.02em] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.28)] transition-shadow hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.6)] sm:h-12 sm:px-5 sm:text-base"
          >
            Explore rates
          </Link>
        </div>
      </div>
      <div
        aria-hidden="true"
        className="absolute bottom-[99px] left-1/2 z-[4] flex -translate-x-1/2 items-center gap-3 text-[8px] tracking-[0.07em] text-[#fafaf7] uppercase [opacity:calc(1-var(--fade)*4)] sm:bottom-[98px] sm:text-[10px]"
      >
        Scroll to explore
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 5v14M19 12l-7 7-7-7" />
        </svg>
      </div>
    </section>
  );
}
