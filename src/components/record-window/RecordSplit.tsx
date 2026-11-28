// A record window's two sides (M-20261127-124, M-20261127-125): the fields
// column at the left, the rest at the right, each scrolling on its own, the
// split between them dragged (or moved with the arrow keys, a double-click
// returning it to its default) and kept per person and per type of window.
// The right side's head (a ticket's tabs, M-20261127-106) stays out of what
// scrolls (M-20261127-134).
//
// Narrow (the window under `stackBelow`), the two sides are one column that
// scrolls: the fields first, then the right side's head, which sticks at the
// top of the column while the rest scrolls under it, so the tabs stay in view.
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { keepRecordWindow, useRecordWindow } from "@/lib/record-window-layout";

const KEY_STEP = 24;

/** The fields column's width: the kept one, else the default, always leaving the right side its least. */
export function splitWidth(kept: number | undefined, fallback: number, total: number, least: number, rightLeast: number): number {
  const most = Math.max(least, total - rightLeast);
  return Math.round(Math.min(most, Math.max(least, kept ?? fallback)));
}

/** The width of the box, read on every change; 0 in a renderer with no layout. */
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [ref]);
  return width;
}

export interface RecordSplitProps {
  /** the window's type: the split is kept for it */
  type: string;
  left: ReactNode;
  right: ReactNode;
  /** over the right side, out of what scrolls (a ticket's tabs) */
  rightHead?: ReactNode;
  /** the fields column's default width, in px */
  fallback?: number;
  /** under this width of the window the sides are one column, in px */
  stackBelow?: number;
  /** the least of each side, in px */
  least?: number;
  rightLeast?: number;
  className?: string;
}

const SCROLL = "record-scroll min-h-0 overflow-y-auto overscroll-contain";

export function RecordSplit({ type, left, right, rightHead, fallback = 360, stackBelow = 760, least = 240, rightLeast = 360, className }: RecordSplitProps) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const kept = useRecordWindow(type).split;
  const [live, setLive] = useState<number | null>(null);
  const drag = useRef<{ pointer: number; x: number; start: number; last: number } | null>(null);
  const stacked = width > 0 && width < stackBelow;
  // no layout yet (a test renderer): nothing bounds the column but its least
  const total = width || Number.POSITIVE_INFINITY;
  const shown = splitWidth(live ?? kept, fallback, total, least, rightLeast);
  const keep = (value: number | undefined) => { keepRecordWindow(type, { split: value }); setLive(null); };
  if (stacked) {
    return (
      <div ref={box} className={cn(SCROLL, "flex flex-1 flex-col", className)} data-record-split="stacked">
        <div className="shrink-0" data-record-side="left">{left}</div>
        {rightHead && <div className="sticky top-0 z-[2] shrink-0 [background-color:var(--float-fill)]" data-record-side-head="">{rightHead}</div>}
        <div className="shrink-0" data-record-side="right">{right}</div>
      </div>
    );
  }
  return (
    <div ref={box} className={cn("relative flex min-h-0 flex-1", className)} data-record-split="sides">
      <div className={cn(SCROLL, "shrink-0")} style={{ width: shown }} data-record-side="left">{left}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("recordWindow.split")}
        aria-valuenow={shown}
        aria-valuemin={least}
        tabIndex={0}
        title={t("recordWindow.splitHint")}
        data-record-split-handle=""
        className="app-resize-handle"
        style={{ left: shown - 3 }}
        onPointerDown={(event) => {
          if (event.button > 0) return;
          event.preventDefault();
          drag.current = { pointer: event.pointerId, x: event.clientX, start: shown, last: shown };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          const from = drag.current;
          if (!from || from.pointer !== event.pointerId) return;
          from.last = splitWidth(from.start + event.clientX - from.x, fallback, total, least, rightLeast);
          setLive(from.last);
        }}
        onPointerUp={(event) => {
          const from = drag.current;
          if (!from || from.pointer !== event.pointerId) return;
          drag.current = null;
          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          if (from.last !== from.start) keep(from.last);
          else setLive(null);
        }}
        onPointerCancel={() => { drag.current = null; setLive(null); }}
        onDoubleClick={() => keep(undefined)}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); keep(undefined); return; }
          const step = event.key === "ArrowLeft" ? -KEY_STEP : event.key === "ArrowRight" ? KEY_STEP : 0;
          if (!step) return;
          event.preventDefault();
          keep(splitWidth(shown + step, fallback, total, least, rightLeast));
        }}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col border-s border-popover-hairline" data-record-side="right-column">
        {rightHead && <div className="shrink-0" data-record-side-head="">{rightHead}</div>}
        <div className={cn(SCROLL, "flex-1")} data-record-side="right">{right}</div>
      </div>
    </div>
  );
}
