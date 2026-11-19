// The right-hand docked panel (bot settings, person) is one resizable column
// for the whole app: one drag handle on its left edge, one width (320 to 720
// px) stored under one key, so a person opens at the width the bot panel was
// left at. Both panels use this hook and handle instead of their own copy.
// Another column (the side thread) passes its own key and bounds, so its
// width is remembered apart from the panels'.
//
// The same hook and handle resize a box that floats (the record card, #5053):
// `ResizeHandle` takes the size each travel of the pointer moves (across, down
// or both for a corner), which way it grows, and the room the window leaves.
// A size is one number under one key, a width or a height alike.
import { useRef, useState } from "react";
import { cn } from "@/lib/cn";

export const DOCKED_PANEL_WIDTH_KEY = "omb-settings-panel-width";
export const DOCKED_PANEL_MIN_WIDTH = 320;
export const DOCKED_PANEL_MAX_WIDTH = 720;
export const DOCKED_PANEL_DEFAULT_WIDTH = 360;
const KEY_STEP = 24;

/** Where a column's width is stored and how far it may go. */
export type DockedPanelBounds = { key: string; min: number; max: number; fallback: number };

const DOCKED_PANEL_BOUNDS: DockedPanelBounds = {
  key: DOCKED_PANEL_WIDTH_KEY,
  min: DOCKED_PANEL_MIN_WIDTH,
  max: DOCKED_PANEL_MAX_WIDTH,
  fallback: DOCKED_PANEL_DEFAULT_WIDTH,
};

/** The bot panel opens at 308 px like Grok Bot's (#2141); other panels keep 320/360. */
export const BOT_PANEL_WIDTH_KEY = "omb-bot-panel-width";
export const BOT_PANEL_BOUNDS: DockedPanelBounds = {
  key: BOT_PANEL_WIDTH_KEY,
  min: 308,
  max: DOCKED_PANEL_MAX_WIDTH,
  fallback: 308,
};

export function readDockedPanelWidth(bounds: DockedPanelBounds = DOCKED_PANEL_BOUNDS): number {
  try {
    const stored = Number(localStorage.getItem(bounds.key));
    if (Number.isFinite(stored) && stored >= bounds.min && stored <= bounds.max) return stored;
  } catch { /* default width */ }
  return bounds.fallback;
}

/** Inside the bounds, and inside the room the place leaves right now: a room
 * smaller than the minimum wins (a box cannot be larger than its window). */
export function clampPanelSize(size: number, bounds: DockedPanelBounds, room: number = bounds.max): number {
  const most = Math.min(bounds.max, room);
  return Math.round(Math.max(Math.min(bounds.min, most), Math.min(most, size)));
}
const storeWidth = (width: number, bounds: DockedPanelBounds) => {
  try { localStorage.setItem(bounds.key, String(width)); } catch { /* session only */ }
};
const forgetWidth = (bounds: DockedPanelBounds) => {
  try { localStorage.removeItem(bounds.key); } catch { /* session only */ }
};

/** One kept size: `width` is the number under `bounds.key` (a column's width,
 * a card's width or its height), or the fallback while nothing is kept. */
export function useDockedPanelWidth(bounds: DockedPanelBounds = DOCKED_PANEL_BOUNDS) {
  const [width, setWidth] = useState(() => readDockedPanelWidth(bounds));
  return { width, setWidth, bounds };
}
export type DockedPanelSize = ReturnType<typeof useDockedPanelWidth>;

/** One size a handle moves. */
export interface ResizeAxis {
  panel: DockedPanelSize;
  /** 1: the size grows as the pointer goes right (or down); -1: as it goes left (or up) */
  toward: 1 | -1;
  /** how much the size changes for one pixel of travel: 2 for a box that stays centred (default 1) */
  rate?: number;
  /** the most the size may be right now, when its place allows less than `bounds.max` (the window) */
  room?: () => number;
}

type Travel = { axis: ResizeAxis; across: boolean; start: number; current: number };

/** The size shown now: the kept one, bounded by the room. */
const shownSize = (axis: ResizeAxis) => clampPanelSize(axis.panel.width, axis.panel.bounds, axis.room?.());

/**
 * The app's one resize handle (`.app-resize-handle`): invisible at rest, a
 * 2px accent line on hover, drag and keyboard focus. `x` is the size a travel
 * across moves, `y` the size a travel down moves; both make a corner. The kept
 * value is written when a drag ends on another size than it began with, and on
 * each arrow key (24px a step). With `reset`, a double-click or Enter returns
 * those sizes to their default and forgets the kept values. `quiet` handles
 * (a second edge, a corner) are for the pointer only: out of the tab order and
 * hidden from a screen reader, which has the edges' own separators.
 */
export function ResizeHandle({ label, x, y, reset, quiet = false, title, corner, onResizing, className }: {
  label: string;
  x?: ResizeAxis;
  y?: ResizeAxis;
  reset?: readonly DockedPanelSize[];
  quiet?: boolean;
  title?: string;
  /** which bottom corner a two-way handle sits on */
  corner?: "se" | "sw";
  onResizing?: (active: boolean) => void;
  className?: string;
}) {
  const gesture = useRef<{ pointer: number; x: number; y: number; travels: Travel[] } | null>(null);
  const [resizing, setResizing] = useState(false);
  const main = x ?? y;
  const end = (target: Element, pointer: number) => {
    const from = gesture.current;
    if (!from || from.pointer !== pointer) return;
    gesture.current = null;
    setResizing(false);
    onResizing?.(false);
    if (target.hasPointerCapture?.(pointer)) target.releasePointerCapture(pointer);
    // a press that moved nothing keeps the kept value (a window that bounds the box must not overwrite it)
    for (const travel of from.travels) if (travel.current !== travel.start) storeWidth(travel.current, travel.axis.panel.bounds);
  };
  const toDefault = () => {
    for (const panel of reset ?? []) {
      forgetWidth(panel.bounds);
      panel.setWidth(panel.bounds.fallback);
    }
  };
  return (
    <div
      role="separator"
      aria-orientation={x ? "vertical" : "horizontal"}
      aria-label={label}
      aria-hidden={quiet || undefined}
      aria-valuemin={main?.panel.bounds.min}
      aria-valuemax={main?.panel.bounds.max}
      aria-valuenow={main?.panel.width}
      tabIndex={quiet ? undefined : 0}
      title={title}
      data-resizing={resizing || undefined}
      data-resize-corner={x && y ? corner ?? "se" : undefined}
      onPointerDown={(event) => {
        if (event.button > 0) return;
        const travels: Travel[] = [];
        if (x) { const start = shownSize(x); travels.push({ axis: x, across: true, start, current: start }); }
        if (y) { const start = shownSize(y); travels.push({ axis: y, across: false, start, current: start }); }
        gesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, travels };
        setResizing(true);
        onResizing?.(true);
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const from = gesture.current;
        if (!from || from.pointer !== event.pointerId) return;
        for (const travel of from.travels) {
          const { axis } = travel;
          const moved = travel.across ? event.clientX - from.x : event.clientY - from.y;
          const next = clampPanelSize(travel.start + axis.toward * (axis.rate ?? 1) * moved, axis.panel.bounds, axis.room?.());
          travel.current = next;
          axis.panel.setWidth(next);
        }
      }}
      onPointerUp={(event) => end(event.currentTarget, event.pointerId)}
      onPointerCancel={(event) => end(event.currentTarget, event.pointerId)}
      onDoubleClick={reset ? toDefault : undefined}
      onKeyDown={(event) => {
        if (reset && event.key === "Enter") {
          event.preventDefault();
          toDefault();
          return;
        }
        const across = event.key === "ArrowLeft" ? -KEY_STEP : event.key === "ArrowRight" ? KEY_STEP : 0;
        const down = event.key === "ArrowUp" ? -KEY_STEP : event.key === "ArrowDown" ? KEY_STEP : 0;
        const axis = across ? x : down ? y : undefined;
        if (!axis) return;
        event.preventDefault();
        const next = clampPanelSize(shownSize(axis) + axis.toward * (across || down), axis.panel.bounds, axis.room?.());
        storeWidth(next, axis.panel.bounds);
        axis.panel.setWidth(next);
      }}
      className={cn("app-resize-handle", className)}
    />
  );
}

/** A docked column's handle: on its left edge, wider as it is pulled left. */
export function DockedPanelResizeHandle({ label, panel }: { label: string; panel: DockedPanelSize }) {
  return <ResizeHandle label={label} x={{ panel, toward: -1 }} className="-left-[3px] hidden lg:block" />;
}
