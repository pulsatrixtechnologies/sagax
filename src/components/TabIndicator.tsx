// The selected tab's pill, sliding from the tab that was selected to the new
// one (#2595), the way Grok Bot, Claude desktop and Apple's segmented controls
// move it. One shared primitive for every tablist: wrap the tablist's tabs in
// <TabIndicatorGroup>, give each tab the `relative` class, and render
// <TabIndicator /> inside the selected one only.
//
// The slide is HORIZONTAL only (JC 2026-11-19). It was a shared layout
// (motion's layoutId), which measures both pills against the viewport: when
// a tab change shortens the page (General is long, Outcomes is short) the
// scroll area clamps its scrollTop, the whole tab row jumps down in the same
// frame, and the pill flew in from the old, scrolled-up position, from the
// top. Here the pill remembers only the left edge and the width of the one
// it replaces and animates `translateX` and `width` (WAAPI, compositor-friendly,
// corners untouched); the vertical position is never part of it, so a
// scroll or a wrap onto another row never moves it. Reduced motion (the
// system setting, or the in-app switch on the root) makes the pill jump.
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type MutableRefObject } from "react";
import { EASE, MOTION_MS, prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/cn";

/** The cubic-bezier of the app's out-quint curve, as a tween takes it. */
const OUT_QUINT = EASE.outQuint.replace(/^cubic-bezier\(|\)$/g, "").split(",").map(Number) as [number, number, number, number];

export const TAB_INDICATOR_TRANSITION = { type: "tween", duration: MOTION_MS.moderate / 1000, ease: OUT_QUINT } as const;

/** Reduced motion, followed live: the media query and the root attribute. */
export function useReducedMotionPreference(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    const update = () => setReduced(prefersReducedMotion());
    const query = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    query?.addEventListener?.("change", update);
    const observer = typeof MutationObserver === "function" ? new MutationObserver(update) : null;
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-reduced-motion"] });
    return () => {
      query?.removeEventListener?.("change", update);
      observer?.disconnect();
    };
  }, []);
  return reduced;
}

/** Where the pill that just left stood: the horizontal edge and width only. */
export interface IndicatorSpan { left: number; width: number }

/** The keyframes of the slide from `from` to `to`: a horizontal translate and
 * a width, never a vertical offset. Null when it has nowhere to slide. */
export function indicatorSlide(from: IndicatorSpan | null, to: IndicatorSpan): Keyframe[] | null {
  if (!from) return null;
  const dx = from.left - to.left;
  if (Math.abs(dx) < 0.5 && Math.abs(from.width - to.width) < 0.5) return null;
  return [
    { transform: `translateX(${dx}px)`, width: `${from.width}px` },
    { transform: "translateX(0)", width: `${to.width}px` },
  ];
}

interface Scope { last: MutableRefObject<IndicatorSpan | null>; reduced: boolean }
const ScopeContext = createContext<Scope | null>(null);

/** Scopes one tablist's pill, so two tablists on screen never trade it. */
export function TabIndicatorGroup({ children }: { children: ReactNode }) {
  const last = useRef<IndicatorSpan | null>(null);
  const reduced = useReducedMotionPreference();
  const scope = useRef<Scope>({ last, reduced });
  scope.current.reduced = reduced;
  return <ScopeContext.Provider value={scope.current}>{children}</ScopeContext.Provider>;
}

/** The pill, behind the selected tab's label. The tab is `relative`; its
 * label sits in a `relative` span (or any positioned element) above it. */
export function TabIndicator({ className }: { className?: string }) {
  const scope = useContext(ScopeContext);
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const to = { left: rect.left, width: rect.width };
    const frames = scope && !scope.reduced && typeof node.animate === "function" ? indicatorSlide(scope.last.current, to) : null;
    if (scope) scope.last.current = to;
    const animation = frames ? node.animate(frames, { duration: MOTION_MS.moderate, easing: EASE.outQuint }) : null;
    return () => {
      // the span the next pill slides from (where this one is drawn now, mid-slide included)
      const now = node.getBoundingClientRect();
      if (scope && now.width > 0) scope.last.current = { left: now.left, width: now.width };
      animation?.cancel();
    };
  }, [scope]);
  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-tab-indicator=""
      className={cn("pointer-events-none absolute inset-0 rounded-[inherit] bg-hover", className)}
    />
  );
}
