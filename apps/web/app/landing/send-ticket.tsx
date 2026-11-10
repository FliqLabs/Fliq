"use client";

import Image from "next/image";
import { useEffect, useState, type RefObject } from "react";
import { QrCode } from "../components/app/qr-code";

const STEP_MS = 3200;

const ticketGrid = "grid grid-cols-1 drop-shadow-[0_18px_40px_rgba(0,0,0,0.45)] sm:grid-cols-[1fr_245px]";
const mainShape =
  "rounded-t-[18px] [mask:radial-gradient(circle_10px_at_0_100%,transparent_98%,#000)_left/51%_100%_no-repeat,radial-gradient(circle_10px_at_100%_100%,transparent_98%,#000)_right/51%_100%_no-repeat] sm:rounded-l-[22px] sm:rounded-tr-none sm:[mask:radial-gradient(circle_10px_at_100%_0,transparent_98%,#000)_top/100%_51%_no-repeat,radial-gradient(circle_10px_at_100%_100%,transparent_98%,#000)_bottom/100%_51%_no-repeat]";
const stubShape =
  "rounded-b-[18px] border-t-2 border-dashed border-white/35 [mask:radial-gradient(circle_10px_at_0_0,transparent_98%,#000)_left/51%_100%_no-repeat,radial-gradient(circle_10px_at_100%_0,transparent_98%,#000)_right/51%_100%_no-repeat] sm:rounded-r-[22px] sm:rounded-bl-none sm:border-t-0 sm:border-l-2 sm:[mask:radial-gradient(circle_10px_at_0_0,transparent_98%,#000)_top/100%_51%_no-repeat,radial-gradient(circle_10px_at_0_100%,transparent_98%,#000)_bottom/100%_51%_no-repeat]";

const steps = [
  {
    badge: "Draft",
    title: "Pick who gets paid",
    body: "DARA OKONKWO at GTBank, name checked before you pay.",
    via: "—",
    amount: "$50.00",
  },
  {
    badge: "Routing",
    title: "Best of four rates",
    body: "Four providers quote at once. Paycrest wins at ₦1,376.32 per $1.",
    via: "Paycrest",
    amount: "₦68,816",
  },
  {
    badge: "Paid",
    title: "In the bank in 21 seconds",
    body: "Settled with a bank reference DARA can check.",
    via: "Paycrest",
    amount: "₦68,816",
  },
] as const;

const badgeTone = [
  "bg-black/[0.06] text-zinc-600",
  "bg-[#a594ff]/25 text-[#3d2fb8]",
  "bg-[#5b4be0] text-white",
];

function Plane() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 3 3 10.5l7 2.5 2.5 7L21 3Z" />
      <path d="m10 13 4.5-4.5" />
    </svg>
  );
}

export function SendTicket({
  active,
  ticketRef,
  stepperRef,
  hidden,
}: {
  active: boolean;
  ticketRef?: RefObject<HTMLDivElement | null>;
  stepperRef?: RefObject<HTMLDivElement | null>;
  hidden?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const step = steps[index];

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setIndex((current) => (current + 1) % steps.length), STEP_MS);
    return () => clearTimeout(timer);
  }, [active, index]);

  return (
    <div className="mx-auto w-full max-w-[904px] font-sans">
      <div
        ref={ticketRef}
        style={hidden ? { opacity: 0 } : undefined}
        className={`relative z-[2] ${ticketGrid}`}
      >
        <div
          className={`${mainShape} bg-[#fafaf7] px-[22px] py-5 text-[#0d0d12] sm:px-[38px] sm:pt-[34px] sm:pb-[32px]`}
        >
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-2 text-[17px] font-semibold tracking-[-0.02em]">
              <Image src="/logo.png" alt="" width={24} height={24} className="size-6 rounded-full" />
              fliq
            </span>
            <span
              className={`rounded-full px-3 py-1 text-[13px] font-medium transition-colors duration-300 ${badgeTone[index]}`}
            >
              {step.badge}
            </span>
          </div>
          <div className="mt-5 flex items-center gap-3 sm:mt-7 sm:gap-4">
            <span className="text-[40px] leading-none font-medium tracking-[-0.04em] sm:text-[64px]">
              USDC
            </span>
            <span className="relative flex flex-1 items-center gap-2 text-zinc-700">
              <Plane />
              <span className="h-px flex-1 bg-black/15">
                <span
                  className="block h-px bg-[#5b4be0] transition-[width] duration-700 ease-out"
                  style={{ width: `${(index / (steps.length - 1)) * 100}%` }}
                />
              </span>
            </span>
            <span className="text-[40px] leading-none font-medium tracking-[-0.04em] sm:text-[64px]">
              NGN
            </span>
          </div>
          <div className="mt-2 flex justify-between text-[13px] text-zinc-500 sm:mt-3 sm:text-[17px]">
            <span>Solana</span>
            <span>Nigeria</span>
          </div>
          <dl className="mt-6 grid grid-cols-[1.4fr_1fr_auto] gap-x-4 sm:mt-9">
            <dt className="text-[12px] text-zinc-500 sm:text-[15px]">To</dt>
            <dt className="text-[12px] text-zinc-500 sm:text-[15px]">Via</dt>
            <dt className="text-right text-[12px] text-zinc-500 sm:text-[15px]">Amount</dt>
            <dd className="mt-1.5 truncate text-[15px] font-medium sm:mt-2.5 sm:text-[21px]">DARA OKONKWO</dd>
            <dd className="mt-1.5 text-[15px] sm:mt-2.5 sm:text-[21px]">{step.via}</dd>
            <dd className="mt-1.5 text-right text-[15px] font-medium tabular-nums sm:mt-2.5 sm:text-[21px]">
              {step.amount}
            </dd>
          </dl>
        </div>
        <div
          className={`${stubShape} flex items-center justify-between gap-4 bg-[#5b4be0] px-[22px] py-5 text-white sm:flex-col sm:justify-center sm:px-6 sm:py-[30px]`}
        >
          <div className="text-left sm:text-center">
            <span className="block text-[12px] text-white/70 sm:text-[14px]">Fees</span>
            <span
              className={`mt-1 block text-[26px] font-medium tracking-[-0.03em] transition-opacity duration-500 sm:text-[34px] ${index === 0 ? "opacity-40" : "opacity-100"}`}
            >
              ₦344
            </span>
          </div>
          <div className="size-[76px] overflow-hidden rounded-xl bg-white p-1 sm:my-5 sm:size-[100px] sm:rounded-2xl sm:p-1.5 [&_svg]:size-full">
            <QrCode value="https://fliq.cash" label="QR code for fliq.cash" />
          </div>
          <span className="hidden text-[14px] text-white/75 sm:block">fliq.cash</span>
        </div>
      </div>
      <div ref={stepperRef} style={hidden ? { opacity: 0 } : undefined} className="mt-8 text-center sm:mt-9">
        <div className="flex justify-center gap-1.5" role="tablist" aria-label="Send steps">
          {steps.map((item, position) => (
            <button
              key={item.title}
              type="button"
              role="tab"
              aria-selected={position === index}
              aria-label={item.title}
              onClick={() => setIndex(position)}
              className="py-2"
            >
              <span
                className={`block h-[3px] w-7 rounded-full transition-colors duration-300 ${position === index ? "bg-white" : "bg-white/15"}`}
              />
            </button>
          ))}
        </div>
        <p className="mt-3 text-[20px] tracking-[-0.02em] text-[#fafaf7]" aria-live="polite">
          {step.title}
        </p>
        <p className="mt-2 text-[15px] text-zinc-400">{step.body}</p>
      </div>
    </div>
  );
}
