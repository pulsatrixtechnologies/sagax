// The right rail of a main-column page (2026-11-03): Automations' calendar
// rail (month, Upcoming) and the Memory page's explorer are this one piece,
// so their side, width, border, fold and breakpoint cannot drift apart.
// Open, it is a 280px column with a border on its left and the "›" fold
// button at the end of the first row (beside the panel's lead control, else alone at the top-left); folded, it is a 40px strip (icon
// and vertical label) that opens it again. The rail's own 8px inset plus the
// aside's 16px right padding put its content on the page header's 24px
// right edge (the close button's edge), on both pages. It opens from 1280px and starts
// folded below, the state living with the page for the session.
import { ChevronRight } from "lucide-react";
import { useCallback, useSyncExternalStore, useState, type HTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/** The rail opens from this width; below it the page starts with the strip. */
export const RIGHT_RAIL_OPEN_FROM = 1280;

/** Whether the rail starts open in this window. */
export function rightRailStartsOpen(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(`(min-width: ${RIGHT_RAIL_OPEN_FROM}px)`).matches;
}

/** Whether the window is wide enough for the list and the rail side by side. */
function subscribeWide(notify: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(`(min-width: ${RIGHT_RAIL_OPEN_FROM}px)`);
  query.addEventListener?.("change", notify);
  return () => query.removeEventListener?.("change", notify);
}

/** The rail's open state, as both pages keep it. From the breakpoint it sits beside the list, open at first, then
 * whatever the person chose. Below it the list and the rail cannot both fit (a phone showed "Toutes les notes"
 * one letter per line), so the rail is an overlay sheet over the list: closed at first, with its own choice that
 * never carries over from the wide window, and never side by side. */
export function useRightRailOpen(): [boolean, (open: boolean | ((was: boolean) => boolean)) => void] {
  const wide = useSyncExternalStore(subscribeWide, rightRailStartsOpen, () => false);
  const [wideOpen, setWideOpen] = useState(rightRailStartsOpen);
  const [sheetOpen, setSheetOpen] = useState(false);
  const setOpen = useCallback((next: boolean | ((was: boolean) => boolean)) => (wide ? setWideOpen : setSheetOpen)(next), [wide]);
  return [wide ? wideOpen : sheetOpen, setOpen];
}

type DataAttributes = { [key: `data-${string}`]: string | undefined };

export interface RightRailPanelProps extends Omit<HTMLAttributes<HTMLElement>, "children">, DataAttributes {
  /** The column's accessible name. */
  label: string;
  /** Folds the rail into its strip; the "›" sits in its own row above the content. */
  onCollapse?: () => void;
  /** The fold button's name ("Hide upcoming routines"). */
  hideLabel?: string;
  /** The panel's own first control (a search, a title): it shares the fold button's row, so the "›" is never alone. */
  lead?: ReactNode;
  children: ReactNode;
}

export function RightRailPanel({ label, onCollapse, hideLabel, lead, className, children, ...rest }: RightRailPanelProps) {
  return (
    <>
      {/* below 1280px the rail is a sheet over the list: a press on the list behind closes it */}
      {onCollapse && <button type="button" tabIndex={-1} aria-hidden="true" data-right-rail-scrim="" onClick={onCollapse} className="absolute inset-0 z-30 cursor-default bg-black/40 min-[1280px]:hidden" />}
    <aside
      {...rest}
      aria-label={label}
      data-right-rail=""
      className={cn("flex h-full w-[280px] shrink-0 flex-col overflow-hidden border-l border-pane-edge bg-panel pr-4 max-[1279px]:absolute max-[1279px]:inset-y-0 max-[1279px]:right-0 max-[1279px]:z-40 max-[1279px]:max-w-[calc(100%-48px)] max-[1279px]:shadow-xl", className)}
    >
      {onCollapse && (
        <div className={cn("relative flex shrink-0 items-center gap-1 px-2", lead ? "pt-2.5" : "pt-2")} data-right-rail-head="">
          {lead ? <div className="flex min-w-0 flex-1 items-center">{lead}</div> : null}
          <button type="button" onClick={onCollapse} aria-label={hideLabel} title={hideLabel} className={cn("shrink-0 rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink", lead && "ml-1 grid size-[34px] place-items-center rounded-none border-l border-hairline/40 p-0")} data-right-rail-hide="">
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      {children}
    </aside>
    </>
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
}

export function RightRailStrip({ onOpen, showLabel, title, icon, text, ...rest }: RightRailStripProps) {
  return (
    <button
      {...rest}
      type="button"
      onClick={onOpen}
      aria-label={showLabel}
      title={title ?? showLabel}
      data-right-rail-strip=""
      className="flex w-10 shrink-0 flex-col items-center gap-2 border-l border-pane-edge bg-panel px-1 py-4 text-[11px] text-ink-secondary hover:bg-raised hover:text-ink"
    >
      {icon}
      <span className="[writing-mode:vertical-rl]">{text}</span>
    </button>
  );
}
