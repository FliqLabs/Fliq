"use client";

import { useEffect, type RefObject } from "react";
import Lenis, { type VirtualScrollData } from "lenis";

const FORWARD_DURATION = 1.18;
const REVERSE_DURATION = 1.08;
const MINIMUM_DURATION = 0.35;
const ENDPOINT_HOLD = 150;
const OPPOSITE_INTENT = 16;
const NATIVE_INTENT_WINDOW = 650;
const NAVIGATION_BYPASS = 1000;
const EDGE_TOLERANCE = 2;

type Direction = 1 | -1;
type Bounds = { start: number; end: number };
type Phase = "idle" | "animating" | "holding";

// cubic-bezier(.35, 0, 0, 1): solve x by Newton steps, then evaluate y.
function handoffEase(progress: number) {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  let parameter = progress;
  for (let iteration = 0; iteration < 8; iteration++) {
    const difference = ((2.05 * parameter - 2.1) * parameter + 1.05) * parameter - progress;
    if (Math.abs(difference) < 0.00001) break;
    const slope = (6.15 * parameter - 4.2) * parameter + 1.05;
    parameter = Math.max(0, Math.min(1, parameter - difference / slope));
  }
  return (3 - 2 * parameter) * parameter * parameter;
}

function attachHeroHandoff(element: HTMLElement, viewport: HTMLElement) {
  const root = document.documentElement;
  let disposed = false;
  let phase: Phase = "idle";
  let direction: Direction = 1;
  let bounds: Bounds = { start: 0, end: 0 };
  let run = 0;
  let frame = 0;
  let previousFrame: number | null = null;
  let clock = 0;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let oppositeIntent = 0;
  let lastScroll = window.scrollY;
  let bypassUntil = 0;
  let recentIntent: { direction: Direction; time: number } | null = null;
  let frozen: {
    overflow: string;
    overflowPriority: string;
    gutter: string;
    gutterPriority: string;
    changedGutter: boolean;
  } | null = null;

  function freezeViewport() {
    if (frozen) return;
    frozen = {
      overflow: root.style.getPropertyValue("overflow-y"),
      overflowPriority: root.style.getPropertyPriority("overflow-y"),
      gutter: root.style.getPropertyValue("scrollbar-gutter"),
      gutterPriority: root.style.getPropertyPriority("scrollbar-gutter"),
      changedGutter: !getComputedStyle(root).getPropertyValue("scrollbar-gutter").includes("stable"),
    };
    if (frozen.changedGutter) root.style.setProperty("scrollbar-gutter", "stable");
    // Hidden still allows the programmatic scroll but stops native inertia.
    root.style.setProperty("overflow-y", "hidden");
  }

  function releaseViewport() {
    if (!frozen) return;
    const previous = frozen;
    frozen = null;
    if (root.style.getPropertyValue("overflow-y") === "hidden") {
      if (previous.overflow)
        root.style.setProperty("overflow-y", previous.overflow, previous.overflowPriority);
      else root.style.removeProperty("overflow-y");
    }
    if (previous.changedGutter && root.style.getPropertyValue("scrollbar-gutter") === "stable") {
      if (previous.gutter)
        root.style.setProperty("scrollbar-gutter", previous.gutter, previous.gutterPriority);
      else root.style.removeProperty("scrollbar-gutter");
    }
  }

  function stopFrame() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    previousFrame = null;
  }

  function clearHold() {
    if (holdTimer !== undefined) clearTimeout(holdTimer);
    holdTimer = undefined;
  }

  function restingState() {
    const position = window.scrollY;
    return position >= bounds.end - EDGE_TOLERANCE
      ? "settled"
      : position <= bounds.start + EDGE_TOLERANCE
        ? "hero"
        : "idle";
  }

  function cancel(bypass = false) {
    run++;
    phase = "idle";
    oppositeIntent = 0;
    recentIntent = null;
    clearHold();
    stopFrame();
    lenis.stop();
    lenis.start();
    releaseViewport();
    lastScroll = window.scrollY;
    if (bypass) bypassUntil = performance.now() + NAVIGATION_BYPASS;
    element.dataset.handoffState = restingState();
  }

  function tick(time: number) {
    frame = 0;
    if (disposed || phase !== "animating" || document.visibilityState !== "visible") {
      previousFrame = null;
      return;
    }
    if (previousFrame !== null) clock += Math.min(50, Math.max(0, time - previousFrame));
    previousFrame = time;
    lenis.raf(clock);
    if (phase === "animating") frame = requestAnimationFrame(tick);
  }

  function requestTick() {
    if (!frame && phase === "animating" && document.visibilityState === "visible") {
      frame = requestAnimationFrame(tick);
    }
  }

  function finish(currentRun: number) {
    if (disposed || currentRun !== run) return;
    phase = "holding";
    stopFrame();
    lastScroll = window.scrollY;
    element.dataset.handoffState = "hold";
    holdTimer = setTimeout(() => {
      if (disposed || currentRun !== run) return;
      holdTimer = undefined;
      phase = "idle";
      oppositeIntent = 0;
      releaseViewport();
      lastScroll = window.scrollY;
      element.dataset.handoffState = direction > 0 ? "settled" : "hero";
    }, ENDPOINT_HOLD);
  }

  function begin(nextDirection: Direction, from = window.scrollY) {
    const span = bounds.end - bounds.start;
    if (disposed || span <= EDGE_TOLERANCE) return;
    clearHold();
    stopFrame();
    const currentRun = ++run;
    direction = nextDirection;
    phase = "animating";
    oppositeIntent = 0;
    const position = Math.max(bounds.start, Math.min(bounds.end, from));
    const target = direction > 0 ? bounds.end : bounds.start;
    const duration = Math.max(
      MINIMUM_DURATION,
      ((direction > 0 ? FORWARD_DURATION : REVERSE_DURATION) * Math.abs(target - position)) / span,
    );
    freezeViewport();
    element.dataset.handoffState = direction > 0 ? "forward" : "reverse";
    element.dataset.handoffDuration = duration.toFixed(3);
    lenis.scrollTo(position, { immediate: true, force: true });
    lastScroll = position;
    lenis.scrollTo(target, {
      duration,
      lerp: 0,
      easing: handoffEase,
      lock: true,
      force: true,
      onComplete: () => finish(currentRun),
    });
    requestTick();
  }

  function consume(delta: number, event: Event, keyboard = false) {
    if (!delta) return false;
    bypassUntil = 0;
    const nextDirection: Direction = delta > 0 ? 1 : -1;
    if (phase !== "idle") {
      if (event.cancelable) event.preventDefault();
      if (nextDirection !== direction) {
        oppositeIntent += Math.abs(delta);
        if (keyboard || oppositeIntent >= OPPOSITE_INTENT) begin(nextDirection);
      } else {
        oppositeIntent = 0;
      }
      return true;
    }

    const position = window.scrollY;
    const predicted = position + delta;
    let from: number | undefined;
    if (nextDirection > 0) {
      if (position >= bounds.start - EDGE_TOLERANCE && position < bounds.end - EDGE_TOLERANCE)
        from = position;
      else if (position < bounds.start && predicted >= bounds.start) from = bounds.start;
    } else {
      if (position > bounds.start + EDGE_TOLERANCE && position <= bounds.end + EDGE_TOLERANCE)
        from = position;
      else if (position > bounds.end && predicted <= bounds.end) from = bounds.end;
    }
    if (from === undefined || bounds.end - bounds.start <= EDGE_TOLERANCE) return false;
    if (event.cancelable) event.preventDefault();
    begin(nextDirection, from);
    return true;
  }

  function nestedScroll(event: Event, delta: number) {
    for (const node of event.composedPath()) {
      if (!(node instanceof HTMLElement)) continue;
      if (
        node.hasAttribute("data-lenis-prevent") ||
        (event.type === "wheel" && node.hasAttribute("data-lenis-prevent-wheel")) ||
        (event.type.startsWith("touch") && node.hasAttribute("data-lenis-prevent-touch"))
      )
        return true;
      if (node === root || node === document.body) break;
      if (node.scrollHeight <= node.clientHeight + 1) continue;
      const overflow = getComputedStyle(node).overflowY;
      if (!["auto", "scroll", "overlay"].includes(overflow)) continue;
      if (
        (delta > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1) ||
        (delta < 0 && node.scrollTop > 0)
      )
        return true;
    }
    return false;
  }

  function passThrough({ event, deltaX, deltaY }: VirtualScrollData) {
    const pinch = "touches" in event && event.touches.length > 1;
    if (event.ctrlKey || event.metaKey || pinch) {
      if (phase !== "idle") cancel(true);
      recentIntent = null;
      return false;
    }
    if (
      event.defaultPrevented ||
      event.shiftKey ||
      Math.abs(deltaX) > Math.abs(deltaY) ||
      nestedScroll(event, deltaY)
    ) {
      recentIntent = null;
      return false;
    }
    return true;
  }

  const lenis = new Lenis({
    smoothWheel: false,
    syncTouch: false,
    autoRaf: false,
    anchors: false,
    virtualScroll: passThrough,
  });

  function onVirtualScroll({ event, deltaY }: VirtualScrollData) {
    if (event.type !== "wheel" && event.type !== "touchmove") return;
    if (!deltaY) return;
    recentIntent = { direction: deltaY > 0 ? 1 : -1, time: performance.now() };
    consume(deltaY, event);
  }

  function onNativeScroll() {
    const position = window.scrollY;
    const previous = lastScroll;
    lastScroll = position;
    if (
      disposed ||
      performance.now() < bypassUntil ||
      !recentIntent ||
      performance.now() - recentIntent.time > NATIVE_INTENT_WINDOW
    )
      return;
    if (phase !== "idle") {
      if (position < bounds.start - EDGE_TOLERANCE || position > bounds.end + EDGE_TOLERANCE) {
        begin(direction, lenis.animatedScroll);
      }
      return;
    }
    const crossedForward =
      recentIntent.direction > 0 &&
      ((previous <= bounds.start + EDGE_TOLERANCE && position > bounds.start + EDGE_TOLERANCE) ||
        (previous < bounds.end && position > bounds.end + EDGE_TOLERANCE));
    const crossedReverse =
      recentIntent.direction < 0 &&
      ((previous >= bounds.end - EDGE_TOLERANCE && position < bounds.end - EDGE_TOLERANCE) ||
        (previous > bounds.start && position < bounds.start - EDGE_TOLERANCE));
    if (crossedForward) begin(1, bounds.start);
    else if (crossedReverse) begin(-1, bounds.end);
  }

  function onKeyDown(event: KeyboardEvent) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const editor = target?.isContentEditable || target?.closest("input, textarea, select, [role='textbox']");
    if (editor) return;
    if (["Escape", "Home", "End"].includes(event.key)) {
      cancel(true);
      return;
    }
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const pageKey = event.key === "PageDown" || event.key === "PageUp";
    const interactive = target?.closest(
      "a, button, summary, [role='button'], [role='menu'], [role='listbox'], [role='slider']",
    );
    if (!pageKey && interactive) return;
    const step = Math.max(50, window.innerHeight * 0.9);
    const delta =
      event.key === "PageDown"
        ? step
        : event.key === "PageUp"
          ? -step
          : event.key === "ArrowDown"
            ? 50
            : event.key === "ArrowUp"
              ? -50
              : event.key === " "
                ? event.shiftKey
                  ? -step
                  : step
                : 0;
    if (delta) consume(delta, event, true);
  }

  function onClick(event: MouseEvent) {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("a, button, summary, [role='button']")) cancel(true);
  }

  function onHistoryNavigation() {
    cancel(true);
  }

  function onVisibilityChange() {
    stopFrame();
    requestTick();
  }

  function updateGeometry() {
    const previous = bounds;
    const start = element.getBoundingClientRect().top + window.scrollY;
    const viewportHeight = root.clientHeight || window.innerHeight;
    bounds = { start, end: start + Math.max(0, element.offsetHeight - viewportHeight) };
    if (Math.abs(previous.start - bounds.start) < 0.5 && Math.abs(previous.end - bounds.end) < 0.5) return;
    if (bounds.end - bounds.start <= EDGE_TOLERANCE) {
      cancel();
      return;
    }
    if (phase === "animating") {
      const fraction =
        previous.end > previous.start
          ? Math.max(
              0,
              Math.min(1, (lenis.animatedScroll - previous.start) / (previous.end - previous.start)),
            )
          : 0;
      begin(direction, bounds.start + fraction * (bounds.end - bounds.start));
    } else if (phase === "holding") {
      const target = direction > 0 ? bounds.end : bounds.start;
      lenis.scrollTo(target, { immediate: true, force: true });
      lastScroll = target;
    } else {
      element.dataset.handoffState = restingState();
    }
  }

  const offVirtualScroll = lenis.on("virtual-scroll", onVirtualScroll);
  const observer = new ResizeObserver(updateGeometry);
  observer.observe(element);
  observer.observe(viewport);
  updateGeometry();
  window.addEventListener("resize", updateGeometry);
  window.addEventListener("scroll", onNativeScroll, { passive: true });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("click", onClick, true);
  window.addEventListener("popstate", onHistoryNavigation);
  window.addEventListener("hashchange", onHistoryNavigation);
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    disposed = true;
    run++;
    clearHold();
    stopFrame();
    offVirtualScroll();
    observer.disconnect();
    window.removeEventListener("resize", updateGeometry);
    window.removeEventListener("scroll", onNativeScroll);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("popstate", onHistoryNavigation);
    window.removeEventListener("hashchange", onHistoryNavigation);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    releaseViewport();
    lenis.destroy();
    delete element.dataset.handoffState;
    delete element.dataset.handoffDuration;
  };
}

export function useHeroHandoff(section: RefObject<HTMLElement | null>, stage: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = section.current;
    const viewport = stage.current;
    if (!element || !viewport) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce), (max-height: 600px)").matches) return;
    return attachHeroHandoff(element, viewport);
  }, [section, stage]);
}
