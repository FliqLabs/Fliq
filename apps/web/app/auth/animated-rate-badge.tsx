export function AnimatedRateBadge() {
  return (
    <div className="relative h-24 w-full max-w-[460px]">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-3.5 rounded-[62px] bg-[#32b35a]/20 blur-[46px]"
      />
      <div className="relative flex h-full items-center justify-center gap-1.5 rounded-[48px] bg-white/[0.06] px-7">
        <span className="text-[26px] font-light text-[#a3a3a3]">₦</span>
        <span className="text-[clamp(36px,4.2vw,60px)] leading-none font-light tracking-[-0.04em] tabular-nums">
          1,376.32
        </span>
        <span className="ml-1 text-base text-[#a3a3a3]">per $1</span>
      </div>
      <svg
        aria-hidden="true"
        width="460"
        height="96"
        viewBox="0 0 460 96"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        <rect
          x="0.9"
          y="0.9"
          width="458.2"
          height="94.2"
          rx="47.1"
          fill="none"
          stroke="#32b35a"
          strokeOpacity="0.35"
          strokeWidth="1.2"
        />
        <rect
          x="0.9"
          y="0.9"
          width="458.2"
          height="94.2"
          rx="47.1"
          fill="none"
          stroke="#32b35a"
          strokeOpacity="0.9"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeDasharray="247 1030"
          className="auth-rate-trail"
        />
        <rect
          x="0.9"
          y="0.9"
          width="458.2"
          height="94.2"
          rx="47.1"
          fill="none"
          stroke="#fff"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeDasharray="36 1030"
          className="auth-rate-trail"
        />
      </svg>
    </div>
  );
}
