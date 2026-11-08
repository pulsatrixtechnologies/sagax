// The selected tab's pill, sliding from the tab that was selected to the new
// one (#2595), the way Grok Bot, Claude desktop and Apple's segmented controls
// move it. One shared primitive for every tablist: wrap the tablist's tabs in
// <TabIndicatorGroup>, give each tab the `relative` class, and render
// <TabIndicator /> inside the selected one only; motion's shared layout
// (layoutId) carries the pill across, with transform only (corners included),
// even when the tabs wrap onto two rows.
//
// motion (https://motion.dev) is loaded lazily: LazyMotion pulls its layout
// features in a separate chunk the first time a tablist mounts, so the
// shell's first paint does not carry them. Reduced motion (the system
// setting, or the in-app switch on the root) makes the pill jump.
import { useEffect, useId, useState, type ReactNode } from "react";
import { LayoutGroup, LazyMotion, MotionConfig } from "motion/react";
import * as m from "motion/react-m";
import { EASE, MOTION_MS, prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/cn";

const loadFeatures = () => import("@/lib/motion-features").then((mod) => mod.default);

/** The cubic-bezier of the app's out-quint curve, as motion takes it. */
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

/** Scopes one tablist's pill, so two tablists on screen never trade it. */
export function TabIndicatorGroup({ children }: { children: ReactNode }) {
  const id = useId();
  const reduced = useReducedMotionPreference();
  return (
    <LazyMotion features={loadFeatures}>
      <MotionConfig reducedMotion={reduced ? "always" : "never"} transition={TAB_INDICATOR_TRANSITION}>
        <LayoutGroup id={id}>{children}</LayoutGroup>
      </MotionConfig>
    </LazyMotion>
  );
}

/** The pill, behind the selected tab's label. The tab is `relative`; its
 * label sits in a `relative` span (or any positioned element) above it. */
export function TabIndicator({ className }: { className?: string }) {
  return (
    <m.span
      layoutId="tab-indicator"
      aria-hidden="true"
      data-tab-indicator=""
      className={cn("pointer-events-none absolute inset-0 rounded-[inherit] bg-hover", className)}
    />
  );
}
