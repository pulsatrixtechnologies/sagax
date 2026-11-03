// The right rail of a main-column page (2026-11-03): Automations' calendar
// rail (month, Upcoming) and the Memory page's explorer are this one piece,
// so their side, width, border, fold and breakpoint cannot drift apart.
// Open, it is a 280px column with a border on its left and the "›" fold
// button in its own row at the top-left; folded, it is a 40px strip (icon
// and vertical label) that opens it again. It opens from 1280px and starts
// folded below, the state living with the page for the session.
import { ChevronRight } from "lucide-react";
import { useState, type HTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/** The rail opens from this width; below it the page starts with the strip. */
export const RIGHT_RAIL_OPEN_FROM = 1280;

/** Whether the rail starts open in this window. */
export function rightRailStartsOpen(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(`(min-width: ${RIGHT_RAIL_OPEN_FROM}px)`).matches;
}

/** The rail's open state, as both pages keep it: from the breakpoint at
 * first, then whatever the person chose. */
export function useRightRailOpen() {
  return useState(rightRailStartsOpen);
}

const NARROW_HIDDEN = "hidden lg:flex";

type DataAttributes = { [key: `data-${string}`]: string | undefined };

export interface RightRailPanelProps extends Omit<HTMLAttributes<HTMLElement>, "children">, DataAttributes {
  /** The column's accessible name. */
  label: string;
  /** Folds the rail into its strip; the "›" sits in its own row above the content. */
  onCollapse?: () => void;
  /** The fold button's name ("Hide upcoming routines"). */
  hideLabel?: string;
  /** Automations hides the rail under 1024px; Memory keeps it. */
  hideNarrow?: boolean;
  children: ReactNode;
}

export function RightRailPanel({ label, onCollapse, hideLabel, hideNarrow = false, className, children, ...rest }: RightRailPanelProps) {
  return (
    <aside
      {...rest}
      aria-label={label}
      data-right-rail=""
      className={cn("h-full w-[280px] shrink-0 flex-col overflow-hidden border-l border-hairline/40 bg-panel", hideNarrow ? NARROW_HIDDEN : "flex", className)}
    >
      {onCollapse && (
        <div className="flex shrink-0 px-2 pt-2">
          <button type="button" onClick={onCollapse} aria-label={hideLabel} title={hideLabel} className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink" data-right-rail-hide="">
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      {children}
    </aside>
  );
}

export interface RightRailStripProps extends DataAttributes {
  onOpen: () => void;
  /** The strip's accessible name ("Show upcoming routines"). */
  showLabel: string;
  /** Its tooltip; the show label when left out. */
  title?: string;
  icon: ReactNode;
  /** The vertical label under the icon. */
  text: string;
  hideNarrow?: boolean;
}

export function RightRailStrip({ onOpen, showLabel, title, icon, text, hideNarrow = false, ...rest }: RightRailStripProps) {
  return (
    <button
      {...rest}
      type="button"
      onClick={onOpen}
      aria-label={showLabel}
      title={title ?? showLabel}
      data-right-rail-strip=""
      className={cn("w-10 shrink-0 flex-col items-center gap-2 border-l border-hairline/40 bg-panel px-1 py-4 text-[11px] text-ink-secondary hover:bg-raised hover:text-ink", hideNarrow ? NARROW_HIDDEN : "flex")}
    >
      {icon}
      <span className="[writing-mode:vertical-rl]">{text}</span>
    </button>
  );
}
