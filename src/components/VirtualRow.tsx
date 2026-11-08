import { startTransition, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/* Virtualized list rows (#2755). A long list (the chat transcript, the
   sidebar's bots and threads) keeps one light element per row; only the
   rows near the visible part of their scroller render their content. A row
   far from it holds its last measured height, so the scroll range and the
   reader's position never move, and React does none of its work. The row
   element itself stays in place when its content comes and goes, so the
   transcript's off-screen anchor (use-offscreen-row-anchor.ts) and the
   sidebar's reveal keep watching the same node.

   The scroller is the nearest ancestor marked `data-virtual-root`; without
   one the window is the viewport. A row mounts its content when it comes
   within NEAR_MARGIN of the scroller and drops it past FAR_MARGIN, so a
   reader going back and forth near a boundary never makes rows flicker. */

export const VIRTUAL_ROOT_ATTRIBUTE = "data-virtual-root";
export const NEAR_MARGIN_PX = 1200;
export const FAR_MARGIN_PX = 3000;

/** Remembered heights by row key, kept across switches so a bot opened again
 * lays out its rows at their real size at once. Bounded: the oldest entries
 * go first. */
const rememberedHeights = new Map<string, number>();
const REMEMBERED_LIMIT = 4000;

export function rememberRowHeight(key: string, height: number): void {
  if (!(height >= 0)) return;
  rememberedHeights.delete(key);
  rememberedHeights.set(key, Math.round(height));
  if (rememberedHeights.size > REMEMBERED_LIMIT) {
    const oldest = rememberedHeights.keys().next().value;
    if (oldest !== undefined) rememberedHeights.delete(oldest);
  }
}

export function rememberedRowHeight(key: string): number | undefined {
  return rememberedHeights.get(key);
}

/** Pure: the first index that renders at once, counted back from the end of
 * the list until the rows fill `fill` pixels (a remembered height, else the
 * estimate). Rows from there on paint in the first frame of a switch; the
 * rows above wait for their scroller to bring them near. */
export function eagerTailStart(keys: readonly string[], fill: number, estimate: number, height: (key: string) => number | undefined = rememberedRowHeight): number {
  let total = 0;
  for (let index = keys.length - 1; index >= 0; index--) {
    total += height(keys[index]!) ?? estimate;
    if (total >= fill) return index;
  }
  return 0;
}

type Listener = (near: boolean | null, far: boolean | null, height: number) => void;

interface Watcher {
  near: IntersectionObserver;
  far: IntersectionObserver;
  listeners: Map<Element, Listener>;
}

const watchers = new WeakMap<Element, Watcher>();
let viewportWatcher: Watcher | null = null;

function watcherFor(root: Element | null): Watcher | null {
  if (typeof IntersectionObserver === "undefined") return null;
  const existing = root ? watchers.get(root) : viewportWatcher;
  if (existing) return existing;
  const listeners = new Map<Element, Listener>();
  // One batch of entries is one low-priority React update: rows that come
  // near together mount together, without blocking the frame.
  const deliver = (entries: IntersectionObserverEntry[], which: "near" | "far") => {
    startTransition(() => {
      for (const entry of entries) {
        const listener = listeners.get(entry.target);
        if (!listener) continue;
        if (which === "near") listener(entry.isIntersecting, null, entry.boundingClientRect.height);
        else listener(null, entry.isIntersecting, entry.boundingClientRect.height);
      }
    });
  };
  // A scroller that moves both ways (the Team map canvas pans) marks itself
  // `data-virtual-root="both"`: its margins then reach sideways too.
  const both = root?.getAttribute(VIRTUAL_ROOT_ATTRIBUTE) === "both";
  const margin = (px: number) => both ? `${px}px` : `${px}px 0px`;
  const near = new IntersectionObserver((entries) => deliver(entries, "near"), { root, rootMargin: margin(NEAR_MARGIN_PX) });
  const far = new IntersectionObserver((entries) => deliver(entries, "far"), { root, rootMargin: margin(FAR_MARGIN_PX) });
  const watcher = { near, far, listeners };
  if (root) watchers.set(root, watcher);
  else viewportWatcher = watcher;
  return watcher;
}

/** A drawn row's height. A row with no box of its own (display: contents,
 * a message that drew nothing) measures 0: that counts only while its list
 * has a size, never for a list that is itself hidden. */
function remember(element: HTMLElement, key: string, height: number): void {
  if (height > 0) rememberRowHeight(key, height);
  else if (!element.classList.contains("contents") && (element.parentElement?.getBoundingClientRect().height ?? 0) > 0) rememberRowHeight(key, 0);
}

/* Live rows report their height as it changes, from one shared observer
   that runs after layout. A row going away then needs no measure of its own:
   measuring in the unmount of a whole list (a bot switch) forced one layout
   per row while React was removing them. */
const liveHeights = new WeakMap<Element, (height: number) => void>();
let resizeObserver: ResizeObserver | null = null;

function sizeWatcher(): ResizeObserver | null {
  if (resizeObserver || typeof ResizeObserver === "undefined") return resizeObserver;
  resizeObserver = new ResizeObserver((entries) => {
    // a stand-in observer (tests) may call back with no entries
    if (!Array.isArray(entries)) return;
    for (const entry of entries) liveHeights.get(entry.target)?.(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
  });
  return resizeObserver;
}

export interface VirtualRowProps {
  /** Stable identity of the row: its remembered height goes by it. */
  rowKey: string;
  /** Renders its content at once (the visible tail, a focused or anchored
   * row) and keeps it while true. */
  eager?: boolean;
  /** Height before the row was ever measured. */
  estimate: number;
  /** Renders its content on the first render, before the scroller says
   * where the row is: a list that must never paint an empty row when it
   * mounts (the sidebar). The scroller still drops it once it is far. */
  initiallyShown?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Attributes the row carries only while its content is away, so a query
   * for the content's own marks (an unread bot, a bot row) still finds it. */
  heldAttributes?: Record<string, string | undefined>;
  children: ReactNode;
}

export function VirtualRow({ rowKey, eager = false, estimate, initiallyShown = false, className, style, heldAttributes, children }: VirtualRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(() => eager || initiallyShown || typeof IntersectionObserver === "undefined");
  const live = shown || eager;
  const liveRef = useRef(live);
  liveRef.current = live;
  const eagerRef = useRef(eager);
  eagerRef.current = eager;
  // The key a height is remembered by can change without the row moving (the
  // sidebar's density is part of it): the observers stay, only the key follows.
  // Re-observing every row on a density change queued one intersection and one
  // resize callback per row into the frame that opens the sidebar (#2791).
  const keyRef = useRef(rowKey);
  keyRef.current = rowKey;
  // An eager row keeps its content once it stops being eager (a tail row
  // that newer rows pushed up is still on screen); the scroller drops it later.
  useLayoutEffect(() => { if (eager) setShown(true); }, [eager]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const watcher = watcherFor(element.parentElement?.closest(`[${VIRTUAL_ROOT_ATTRIBUTE}]`) ?? null);
    if (!watcher) return;
    watcher.listeners.set(element, (near, far, height) => {
      if (liveRef.current) remember(element, keyRef.current, height);
      if (near) setShown(true);
      else if (far === false && !eagerRef.current) setShown(false);
    });
    watcher.near.observe(element);
    watcher.far.observe(element);
    const sizes = sizeWatcher();
    liveHeights.set(element, (height) => { if (liveRef.current) remember(element, keyRef.current, height); });
    sizes?.observe(element);
    return () => {
      sizes?.unobserve(element);
      liveHeights.delete(element);
      watcher.listeners.delete(element);
      watcher.near.unobserve(element);
      watcher.far.unobserve(element);
    };
  }, []);
  const held = live ? undefined : rememberedRowHeight(rowKey) ?? estimate;
  return (
    <div
      ref={ref}
      className={className}
      data-virtual-row={live ? "live" : "held"}
      style={held === undefined ? style : { ...style, display: "block", height: held }}
      {...(live ? undefined : heldAttributes)}
    >
      {live ? children : null}
    </div>
  );
}
