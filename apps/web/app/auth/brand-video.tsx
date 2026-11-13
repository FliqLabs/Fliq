"use client";

import { useEffect, useRef } from "react";

const SOURCE = "/auth/fliq-brand.mp4";
const POSTER = "/auth/fliq-brand-poster.webp";

export function BrandVideo() {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const wide = window.matchMedia("(min-width: 1024px)").matches;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!wide) return;
    element.poster = POSTER;
    if (calm) return;
    element.src = SOURCE;
    element.play().catch(() => undefined);
  }, []);

  return (
    <video
      ref={video}
      muted
      loop
      playsInline
      preload="none"
      aria-label="Illustrative Fliq payout and agent controls"
      className="aspect-video w-full scale-110 object-cover [mask-image:linear-gradient(to_bottom,transparent,#000_14%,#000_86%,transparent)]"
    />
  );
}
