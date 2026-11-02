import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  useSidebarDensity,
  useSidebarViewport,
  effectiveSidebarDensity,
  sidebarDragTarget,
  SIDEBAR_RAIL_WIDTH,
  toggleSidebarCollapsed,
} from "@/lib/sidebar-preferences";
import { animateSidebarSnap } from "@/lib/sidebar-motion";
import {
  readSidebarWidth,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
} from "./helpers";

/** Chosen in Settings > Appearance or by dragging the edge; one store.
 * Between the phone drawer and 768px the window draws the rail instead
 * (Grok Bot's narrow window), without touching the person's choice. */
export function useSidebarWidth({ sidebarRef }: { sidebarRef: RefObject<HTMLElement | null> }) {
  const savedDensity = useSidebarDensity();
  const viewport = useSidebarViewport();
  const autoRail = viewport === "medium";
  const density = effectiveSidebarDensity(savedDensity, viewport);
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  // `collapsed` follows the drag itself: the density store answers a beat
  // later, and a second crossing in that beat must not toggle twice.
  const sidebarResize = useRef<{ x: number; width: number; current: number; collapsed: boolean } | null>(null);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  // The person's density as of the last toggle, ahead of the store's re-render.
  const densityNow = useRef(savedDensity);
  densityNow.current = savedDensity;
  const setSidebarCollapsed = (collapsed: boolean) => {
    // the automatic rail is the window's, not a choice to save
    if (autoRail) return;
    if ((densityNow.current === "icons") === collapsed) return;
    densityNow.current = toggleSidebarCollapsed();
  };
  // Rail in or out (the edge, its double-click, ⌘B, Settings): the width
  // changes at once and the snap is drawn with transforms for 200ms
  // (src/lib/sidebar-motion.ts), so the chat column is laid out once.
  // A window resized into or out of the automatic rail just lays out again.
  const railed = density === "icons";
  const wasRailed = useRef(railed);
  const wasViewport = useRef(viewport);
  useLayoutEffect(() => {
    const was = wasRailed.current;
    wasRailed.current = railed;
    const viewportChanged = wasViewport.current !== viewport;
    wasViewport.current = viewport;
    const aside = sidebarRef.current;
    if (was === railed || !aside || viewportChanged || viewport !== "wide") return;
    const follower = aside.parentElement?.querySelector<HTMLElement>(":scope > [data-sidebar-follower]") ?? null;
    return animateSidebarSnap(aside, follower, was ? SIDEBAR_RAIL_WIDTH : sidebarWidth, railed ? SIDEBAR_RAIL_WIDTH : sidebarWidth);
    // the width is read when the rail flips, not followed during a drag
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [railed, viewport]);
  const resizeSidebar = (clientX: number) => {
    const from = sidebarResize.current;
    if (!from) return;
    const target = sidebarDragTarget(from.width + (clientX - from.x), { min: SIDEBAR_MIN_WIDTH, max: SIDEBAR_MAX_WIDTH });
    if (target.collapsed !== from.collapsed) setSidebarCollapsed(target.collapsed);
    if (target.collapsed) {
      sidebarResize.current = { ...from, collapsed: true };
      return;
    }
    sidebarResize.current = { ...from, current: target.width, collapsed: false };
    setSidebarWidth(target.width);
  };
  // Compact is the quiet sidebar: a row is its name and its status, nothing
  // else (see the `quiet` prop on BotListItem and GroupListItem).
  const quietRows = density === "compact";

  return {
    savedDensity,
    viewport,
    autoRail,
    density,
    sidebarWidth,
    setSidebarWidth,
    sidebarResize,
    sidebarResizing,
    setSidebarResizing,
    setSidebarCollapsed,
    resizeSidebar,
    quietRows,
    SIDEBAR_RAIL_WIDTH,
  };
}
