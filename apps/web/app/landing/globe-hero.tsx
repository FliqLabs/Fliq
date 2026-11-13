"use client";

import Link from "next/link";
import localFont from "next/font/local";
import { useEffect, useRef, useState, type RefObject } from "react";
import { StoryGlobe } from "./globe-stories";
import { useHeroHandoff } from "./hero-handoff";
import { SendTicket } from "./send-ticket";
import { TileGlobe, globeProjectionDiameter } from "./tile-globe";

const display = localFont({
  src: "./fonts/montserrat-display.woff2",
  weight: "400 900",
  display: "swap",
});

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const portion = (value: number, start: number, end: number) => clamp((value - start) / (end - start));

function useStaticHero() {
  const [isStatic, setStatic] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce), (max-height: 600px)");
    const update = () => setStatic(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return isStatic;
}

function HeroCopy({ copyRef }: { copyRef?: RefObject<HTMLDivElement | null> }) {
  return (
    <div
      ref={copyRef}
      className="absolute inset-x-0 top-0 z-[3] flex h-full flex-col items-center justify-center px-5 pt-[65px] pb-20 text-center text-[#fafaf7] sm:px-6 sm:pb-[30px]"
    >
      <h1
        id="hero-title"
        className="m-0 max-w-[750px] text-[clamp(27px,7.9vw,59px)] leading-[0.98] font-black tracking-[-0.063em] uppercase sm:text-[clamp(42px,4.8vw,78px)] sm:leading-[0.96] sm:tracking-[-0.06em]"
      >
        <span className="block">Dollars in,</span>
        <span className="block">your bank</span>
        <span className="block">account out.</span>
      </h1>
      <p className="mx-0 mt-[22px] mb-[23px] max-w-[min(74vw,270px)] text-xs leading-[1.6] tracking-[-0.035em] text-balance sm:mt-6 sm:mb-[26px] sm:max-w-[430px] sm:text-[clamp(13px,1.28vw,18px)] sm:leading-normal">
        Any chain in. Any bank or mobile money out. Compare current payout routes after fees.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2.5">
        <Link
          href="/dashboard"
          className="inline-flex h-11 items-center gap-[9px] rounded-full bg-white px-[18px] text-sm font-semibold tracking-[-0.02em] text-black transition-transform duration-[280ms] ease-[cubic-bezier(.34,1.56,.64,1)] hover:scale-[1.04] active:scale-[0.96] active:duration-[170ms] motion-reduce:transform-none sm:h-12 sm:px-5 sm:text-base"
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
  );
}

function ProductHeading({
  headingRef,
  hidden,
}: {
  headingRef?: RefObject<HTMLDivElement | null>;
  hidden?: boolean;
}) {
  return (
    <div
      ref={headingRef}
      style={hidden ? { opacity: 0 } : undefined}
      className="mx-auto mb-8 text-center font-sans sm:mb-[38px]"
    >
      <span className="mb-3 block text-[13px] text-zinc-500 sm:mb-4 sm:text-[15px]">
        How a cash-out works
      </span>
      <h2 className="m-0 text-[30px] leading-[1.05] font-normal tracking-[-0.04em] text-[#fafaf7] sm:text-[48px]">
        Three steps. Track every payout.
      </h2>
    </div>
  );
}

function ScrollHint({ hintRef }: { hintRef?: RefObject<HTMLDivElement | null> }) {
  return (
    <div
      ref={hintRef}
      aria-hidden="true"
      className="absolute bottom-[99px] left-1/2 z-[4] flex -translate-x-1/2 items-center gap-3 text-[8px] tracking-[0.07em] text-[#fafaf7] uppercase sm:bottom-[98px] sm:text-[10px]"
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
  );
}

function HeroSequence() {
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const globe = useRef<HTMLDivElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const products = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLDivElement>(null);
  const center = useRef<HTMLDivElement>(null);
  const stepper = useRef<HTMLDivElement>(null);
  const destination = useRef({ x: 0, y: 50, scale: 0.62 });
  const [heroVisible, setHeroVisible] = useState(true);
  const [productVisible, setProductVisible] = useState(false);
  useHeroHandoff(section, stage);

  useEffect(() => {
    const host = section.current;
    const viewport = stage.current;
    const card = center.current;
    if (!host || !viewport || !card) return;
    let frame = 0;

    const apply = () => {
      frame = 0;
      const span = Math.max(1, host.offsetHeight - viewport.clientHeight);
      const progress = clamp((window.scrollY - (host.getBoundingClientRect().top + window.scrollY)) / span);
      const contraction = portion(progress, 0.08, 0.61);
      const target = destination.current;
      const settle = portion(progress, 0.4, 0.7);
      const companions = portion(progress, 0.52, 0.82);

      copy.current!.style.opacity = String(1 - portion(progress, 0.12, 0.36));
      copy.current!.style.transform = `translateY(${-22 * portion(progress, 0.12, 0.36)}px)`;
      hint.current!.style.opacity = String(1 - portion(progress, 0.12, 0.27));
      globe.current!.style.transform = `translate3d(${target.x * contraction}px, ${target.y * contraction}px, 0) scale(${1 + (target.scale - 1) * contraction})`;
      globe.current!.style.opacity = String(1 - portion(progress, 0.42, 0.69));
      const storyLayer = globe.current!.querySelector<HTMLElement>("[data-stories]");
      if (storyLayer) storyLayer.style.opacity = String(1 - portion(progress, 0.02, 0.12));
      scene.current!.style.clipPath = `inset(${22 * contraction}% ${31 * contraction}% ${10 * contraction}% round ${32 * contraction}px)`;
      scene.current!.style.opacity = String(1 - portion(progress, 0.5, 0.75));
      heading.current!.style.opacity = String(portion(progress, 0.42, 0.61));
      center.current!.style.opacity = String(portion(progress, 0.4, 0.63));
      center.current!.style.transform = `translateY(${40 * (1 - settle)}px) scale(${0.96 + settle * 0.04})`;
      stepper.current!.style.opacity = String(companions);
      stepper.current!.style.transform = `translateY(${16 * (1 - companions)}px)`;

      setHeroVisible(progress < 0.3);
      setProductVisible(progress >= 0.47);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    const measure = () => {
      let x = card.offsetWidth / 2;
      let y = card.offsetHeight / 2;
      let node: HTMLElement | null = card;
      while (node && node !== viewport) {
        x += node.offsetLeft;
        y += node.offsetTop;
        node = node.offsetParent as HTMLElement | null;
      }
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      const diameter = card.offsetHeight * (width <= 760 ? 0.9 : 1.1);
      destination.current = {
        x: x - width / 2,
        y: y - height / 2,
        scale: Math.max(0.28, Math.min(0.85, diameter / globeProjectionDiameter(width, height))),
      };
      schedule();
    };

    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(card);
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
    };
  }, []);

  return (
    <section
      ref={section}
      aria-labelledby="hero-title"
      className={`${display.className} relative h-[250svh] sm:h-[240svh]`}
    >
      <div ref={stage} className="sticky top-0 h-[100svh] min-h-[610px] overflow-hidden sm:min-h-[600px]">
        <div ref={scene} aria-hidden="true" className="absolute inset-0 bg-[#17191d]" />
        <div ref={globe} className="absolute inset-0 will-change-transform">
          <StoryGlobe font={display.style.fontFamily} />
        </div>
        <div aria-hidden={!heroVisible} inert={!heroVisible}>
          <HeroCopy copyRef={copy} />
        </div>
        <ScrollHint hintRef={hint} />
        <div
          ref={products}
          aria-hidden={!productVisible}
          inert={!productVisible}
          className="absolute inset-0 z-[5] flex flex-col justify-center px-5 pt-[85px] pb-[90px] sm:px-[5vw] sm:pt-[110px] sm:pb-[95px]"
        >
          <ProductHeading headingRef={heading} hidden />
          <SendTicket active={productVisible} ticketRef={center} stepperRef={stepper} hidden />
        </div>
      </div>
    </section>
  );
}

function StaticHero() {
  return (
    <>
      <section
        aria-labelledby="hero-title"
        className={`${display.className} relative min-h-[100svh] overflow-hidden bg-[#17191d]`}
      >
        <div className="absolute inset-0">
          <TileGlobe font={display.style.fontFamily} reducedMotion />
        </div>
        <HeroCopy />
      </section>
      <section className="px-5 py-16 sm:px-[5vw] sm:py-24">
        <ProductHeading />
        <SendTicket active />
      </section>
    </>
  );
}

export function GlobeHero() {
  return useStaticHero() ? <StaticHero /> : <HeroSequence />;
}
