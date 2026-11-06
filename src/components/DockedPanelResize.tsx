// The right-hand docked panel (bot settings, person) is one resizable column
// for the whole app: one drag handle on its left edge, one width (320 to 720
// px) stored under one key, so a person opens at the width the bot panel was
// left at. Both panels use this hook and handle instead of their own copy.
// Another column (the side thread) passes its own key and bounds, so its
// width is remembered apart from the panels'.
import { useRef, useState } from "react";

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

const clampWidth = (width: number, bounds: DockedPanelBounds) => Math.min(bounds.max, Math.max(bounds.min, width));
const storeWidth = (width: number, bounds: DockedPanelBounds) => {
  try { localStorage.setItem(bounds.key, String(width)); } catch { /* session only */ }
};

export function useDockedPanelWidth(bounds: DockedPanelBounds = DOCKED_PANEL_BOUNDS) {
  const [width, setWidth] = useState(() => readDockedPanelWidth(bounds));
  const drag = useRef<{ x: number; width: number; current: number } | null>(null);
  return { width, setWidth, drag, bounds };
}

export function DockedPanelResizeHandle({ label, panel }: { label: string; panel: ReturnType<typeof useDockedPanelWidth> }) {
  const { width, setWidth, drag, bounds } = panel;
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(event) => {
        drag.current = { x: event.clientX, width, current: width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const from = drag.current;
        if (!from) return;
        const next = clampWidth(from.width + (from.x - event.clientX), bounds);
        drag.current = { ...from, current: next };
        setWidth(next);
      }}
      onPointerUp={(event) => {
        const finished = drag.current?.current;
        if (finished == null) return;
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
        storeWidth(finished, bounds);
      }}
      onKeyDown={(event) => {
        const delta = event.key === "ArrowLeft" ? KEY_STEP : event.key === "ArrowRight" ? -KEY_STEP : 0;
        if (!delta) return;
        event.preventDefault();
        setWidth((current) => {
          const next = clampWidth(current + delta, bounds);
          storeWidth(next, bounds);
          return next;
        });
      }}
      className="app-resize-handle -left-[3px] hidden lg:block"
    />
  );
}
