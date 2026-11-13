"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

function inboxUrl(email: string) {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (domain === "gmail.com" || domain === "googlemail.com") return "https://mail.google.com/mail/u/0/#inbox";
  if (["outlook.com", "hotmail.com", "live.com"].includes(domain))
    return "https://outlook.live.com/mail/0/inbox";
  if (domain === "yahoo.com") return "https://mail.yahoo.com/";
  return null;
}

export function EmailLinkSent({
  email,
  resendAt,
  pending,
  error,
  onResend,
  onChangeEmail,
}: {
  email: string;
  resendAt: number;
  pending: boolean;
  error?: string;
  onResend: () => void;
  onChangeEmail: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [showHelp, setShowHelp] = useState(false);
  useEffect(() => {
    if (Date.now() >= resendAt) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= resendAt) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendAt]);
  const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const inbox = inboxUrl(email);
  const primaryClass =
    "inline-flex min-h-12 cursor-pointer items-center justify-center rounded-xl bg-white px-5 text-[15px] font-medium text-black transition-colors hover:bg-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-[linear-gradient(180deg,#171717_0%,#0b0b0b_50%,#000_100%)] px-6 py-28 text-white">
      <Link
        href="/"
        aria-label="Fliq home"
        className="absolute top-7 left-6 flex items-center gap-2.5 text-xl font-bold tracking-tight sm:left-10"
      >
        <Image src="/logo.png" width={28} height={28} alt="" className="size-7 rounded-full" />
        fliq
      </Link>
      <section
        aria-labelledby="email-sent-heading"
        className="flex w-full max-w-[420px] flex-col items-center gap-[18px] text-center"
      >
        <span
          aria-hidden="true"
          className="inline-flex size-16 items-center justify-center rounded-full bg-[#1a1a1a]"
        >
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 7 9 6 9-6" />
          </svg>
        </span>
        <h1 id="email-sent-heading" className="text-[30px] leading-[1.15] font-semibold tracking-[-0.02em]">
          Check your email
        </h1>
        <p role="status" className="text-[15px] leading-[1.5] text-[#a3a3a3]">
          A sign-in link is on its way to{" "}
          <strong className="break-all font-medium text-white">{email}</strong>. It works once and expires in
          15 minutes.
        </p>
        <div className="flex w-full items-center gap-3 rounded-[14px] bg-[#1a1a1a] p-4 text-left">
          <span
            aria-hidden="true"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-[#242424]"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="9" cy="8" r="3.5" />
              <path d="M3 20a6 6 0 0 1 12 0M16 9l2 2 4-4" />
            </svg>
          </span>
          <span>
            <strong className="block text-sm font-medium">Faster next time</strong>
            <span className="mt-0.5 block text-[13px] text-[#a3a3a3]">
              After you open the link, add a passkey and skip email for good.
            </span>
          </span>
        </div>
        <div className="flex flex-wrap justify-center gap-2.5">
          {inbox ? (
            <a href={inbox} target="_blank" rel="noopener noreferrer" className={primaryClass}>
              Open your inbox
            </a>
          ) : (
            <button
              type="button"
              onClick={() => setShowHelp((value) => !value)}
              aria-expanded={showHelp}
              className={primaryClass}
            >
              Find your sign-in link
            </button>
          )}
          <button
            type="button"
            disabled={remaining > 0 || pending}
            onClick={onResend}
            className="inline-flex min-h-12 cursor-pointer items-center justify-center rounded-xl border border-white/[0.12] bg-white/[0.08] px-5 text-[15px] font-medium transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? (
              "Sending…"
            ) : remaining > 0 ? (
              <span>
                Resend in{" "}
                <span className="ml-1 tabular-nums">
                  {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
                </span>
              </span>
            ) : (
              "Resend link"
            )}
          </button>
        </div>
        {showHelp && (
          <p className="text-[13px] leading-5 text-[#a3a3a3]">
            Open your email inbox and look for the message from fliq. Check spam or junk if it has not
            arrived, then follow the secure sign-in link in that email.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={onChangeEmail}
          className="cursor-pointer text-sm text-[#a3a3a3] transition-colors hover:text-white"
        >
          Use a different email
        </button>
      </section>
    </main>
  );
}
