// The popover at the foot of the sidebar: a trigger that opens a list of
// items above itself. The keyboard handling, the outside-click close and the
// item chrome live here once.
//
// The footer's account row opens on hover when it carries the sidebar's
// places (it is a browsing gesture: you sweep the bottom of the sidebar
// looking for the page you want); a click pins it. A trigger without
// places opens on click only, because a menu that appears under the cursor
// when you are aiming at nothing in particular is startling.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, Pencil, Star } from "lucide-react";
import { cn } from "@/lib/cn";
import { bindHoverIntent, createHoverIntent } from "./sidebar-hover-intent";
import { useMenuMotion } from "./MenuMotion";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { GLASS_POPUP_CHROME_TOP } from "@/lib/glass-popup";

export interface SidebarMenuItem {
  key: string;
  label: string;
  /** a second, quieter line under the label (where "Connect your phone" connects to) */
  subtitle?: string;
  /** a third, quieter line still: a short note (why something is not offered yet) */
  note?: string;
  icon?: React.ReactNode;
  active?: boolean;
  /** the item wants attention (a failed routine, a downloaded update); a
   * folded item cannot show its own dot, so the trigger carries one on its
   * behalf */
  attention?: boolean;
  /** what the attention means — something went wrong (default) or something
   * good is waiting */
  attentionTone?: "danger" | "accent";
  disabled?: boolean;
  /** draw a hairline above this item — the Grok-style trailing group */
  separatorBefore?: boolean;
  /** a small caps label above this item, naming the group it starts (the
   * chat menu's "Share" over the two export actions) */
  heading?: string;
  /** rendered at the trailing edge (a spinner, a status dot) */
  trailing?: React.ReactNode;
  /** the menu normally closes on select; an item that reports progress in
   * place (the update check) keeps it open */
  keepOpen?: boolean;
  onSelect: () => void;
  /** `data-tour` id, so the guided tour can point at this item */
  tourId?: string;
  /** a value in grey at the trailing edge, before the chevron (the reference design's
   * "Weekly usage · 100% used") */
  value?: string;
  /** a second level, opened to the right on hover, click or the right arrow
   * (the reference design's Usage ›, Support ›, Switch account ›); onSelect is unused */
  submenu?: SidebarSubmenuEntry[];
  /** the second level's minimum width (Grok: 228px for Usage, 180px else) */
  submenuWidth?: number;
}

/** A row of a second level: an action, or a read-only line of figures. */
export interface SidebarSubmenuEntry {
  key: string;
  label: string;
  subtitle?: string;
  value?: string;
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
  /** a line of information, not an action */
  info?: boolean;
  /** an info line's star (Usage ›: the plan the Usage row shows). Shown on
   * hover or focus, and always while it is on. */
  favorite?: { on: boolean; label: string; onToggle: () => void };
  /** a check mark: the current choice (the organization in use) */
  checked?: boolean;
  /** the page this row opens is the one on screen */
  active?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  /** the card's foot (Usage ›: the month's cost and View usage): pinned
   * under the rows, outside the part that scrolls, so it stays in view
   * whatever the number of rows above it */
  foot?: boolean;
  /** `data-tour` id, so the guided tour can point at this row */
  tourId?: string;
  /** a tooltip on the row (a server's address under its name) */
  title?: string;
  /** a small Rename button beside the row (its own button, not nested in the row).
   * When `edit` is set, the row shows an inline field (lot 6: no rename window). */
  rename?: {
    label: string;
    onRename: () => void;
    edit?: {
      value: string;
      placeholder: string;
      onChange: (value: string) => void;
      onSave: () => void;
      onCancel: () => void;
    };
  };
  onSelect?: () => void;
}

/** Where a second level sits, in window pixels. */
export interface SubmenuPlace {
  left: number;
  top: number;
  /** the tallest it may be: past it, its rows scroll inside it */
  maxHeight: number;
}

/** The reference's submenu positioner (#4157, measured in the owner's
 * configuration): the level overlaps its row's trailing edge by 4px, so it
 * sits a little over the menu; its top is the row's top; it keeps 12px from
 * the window's sides and bottom, shifting up near the bottom and flipping to
 * the row's other side when the right has no room. At the top it stays
 * under the window's top bar (the title-bar zone the glass pop-ups clear
 * too), so a tall card never covers the top bar's controls. */
export const SUBMENU_SIDE_OFFSET = -4;
export const SUBMENU_WINDOW_MARGIN = 12;
export const SUBMENU_WINDOW_TOP = GLASS_POPUP_CHROME_TOP;

export function submenuPlace(
  row: { left: number; right: number; top: number },
  size: { width: number; height: number } | null,
  viewport: { width: number; height: number },
): SubmenuPlace {
  const margin = SUBMENU_WINDOW_MARGIN;
  const maxHeight = Math.max(0, viewport.height - SUBMENU_WINDOW_TOP - margin);
  const width = size?.width ?? 0;
  const height = Math.min(size?.height ?? 0, maxHeight);
  let left = row.right + SUBMENU_SIDE_OFFSET;
  if (left + width > viewport.width - margin) {
    const flipped = row.left - SUBMENU_SIDE_OFFSET - width;
    left = flipped >= margin ? flipped : Math.max(margin, viewport.width - margin - width);
  }
  const top = Math.max(SUBMENU_WINDOW_TOP, Math.min(row.top, viewport.height - margin - height));
  return { left: Math.round(left), top: Math.round(top), maxHeight };
}

/** How much of the first hidden row a capped card still shows. */
export const SUBMENU_ROW_PEEK = 0.6;

/** Where a card's scrolling rows end when they do not all fit (#4157).
 * Ending on a row boundary made the card look complete with rows hidden
 * under it, so the fold always cuts through a row: the last row that starts
 * above the room left shows its top part, and the fade over it reads as
 * "more below". `null` when every row fits. Rows are given from the top of
 * the scrolling part, in pixels. */
export function submenuRowsFold(rows: ReadonlyArray<{ top: number; height: number }>, room: number): number | null {
  const last = rows[rows.length - 1];
  if (!last || last.top + last.height <= room + 0.5) return null;
  let fold = 0;
  for (const row of rows) {
    const cut = row.top + Math.round(row.height * SUBMENU_ROW_PEEK);
    if (cut <= room && cut > fold) fold = cut;
  }
  return fold > 0 ? fold : Math.max(0, Math.floor(room));
}

/** The room a card's rows have under its height limit, and their fold. */
export function measureRowsFold(level: HTMLElement, rows: HTMLElement, maxHeight: number): number | null {
  // what the card spends outside its rows (padding, gaps, the pinned foot)
  const around = level.offsetHeight - rows.offsetHeight;
  const boxes = [...rows.children].map((child) => {
    const node = child as HTMLElement;
    return { top: node.offsetTop - rows.offsetTop, height: node.offsetHeight };
  });
  return submenuRowsFold(boxes, maxHeight - around);
}

/** Whether a scrolling part has rows below its fold. */
function moreBelow(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight > 1;
}

/** A card keeps an empty star slot on rows without a star when any row has one. */
function hasStarSlot(entries: SidebarSubmenuEntry[]): boolean {
  return entries.some((other) => other.favorite);
}

/** One row of a second level: an info line, an inline rename field, or an action. */
function SubmenuEntryRow({ entry, starSlot, onClose }: { entry: SidebarSubmenuEntry; starSlot: boolean; onClose: () => void }) {
  return (
    <div className="shrink-0">
      {entry.separatorBefore && <MenuDivider />}
      {entry.info ? (
        // the engine and its plan on the first line, the
        // window and its reset on the second; the card grows
        // to its longest row (French included) and, past its
        // cap, a line wraps inside its column, so no text is
        // cut or runs under the percent; the percent and the
        // star share one right edge on every row (#4157)
        <div data-submenu-info="" className="group/info flex items-center gap-2 px-2 py-1.5">
          <span data-info-text="" className="flex min-w-0 flex-1 flex-col">
            <span className="break-words text-ink">{entry.label}</span>
            {entry.subtitle && <span className="break-words text-[12px] leading-4 text-ink-secondary">{entry.subtitle}</span>}
          </span>
          {entry.value && <span className="shrink-0 tabular-nums text-ink-secondary">{entry.value}</span>}
          {!entry.favorite && starSlot && <span data-favorite-slot="" aria-hidden="true" className="size-5 shrink-0" />}
          {entry.favorite && (
            <button
              type="button"
              data-usage-favorite={entry.favorite.on ? "on" : "off"}
              aria-pressed={entry.favorite.on}
              aria-label={entry.favorite.label}
              title={entry.favorite.label}
              onClick={(event) => {
                event.stopPropagation();
                entry.favorite?.onToggle();
              }}
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded outline-none focus-visible:ring-2 focus-visible:ring-focus",
                entry.favorite.on
                  ? "text-accent"
                  : "text-ink-tertiary opacity-0 hover:text-ink group-hover/info:opacity-100 focus-visible:opacity-100 touch:opacity-100",
              )}
            >
              <Star size={13} aria-hidden="true" fill={entry.favorite.on ? "currentColor" : "none"} />
            </button>
          )}
        </div>
      ) : entry.rename?.edit ? (
        <form
          data-rename-inline={entry.key}
          className="flex items-center gap-1.5 rounded-[10px] bg-menu-active px-2 py-1"
          onSubmit={(event) => {
            event.preventDefault();
            entry.rename?.edit?.onSave();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            entry.rename?.edit?.onCancel();
          }}
        >
          {entry.icon && <span data-menu-glyph="" className="menu-glyph">{entry.icon}</span>}
          <input
            autoFocus
            value={entry.rename.edit.value}
            maxLength={80}
            placeholder={entry.rename.edit.placeholder}
            aria-label={entry.rename.label}
            onChange={(event) => entry.rename?.edit?.onChange(event.target.value)}
            className="min-w-0 flex-1 rounded-md border-[0.5px] border-border bg-elevated px-2 py-1 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-focus"
          />
        </form>
      ) : (
        <div className="group/entry relative">
        <button
          type="button"
          role="menuitem"
          data-tour={entry.tourId}
          data-menu-key={entry.key}
          title={entry.title}
          disabled={entry.disabled}
          onClick={() => {
            entry.onSelect?.();
            onClose();
          }}
          className={cn(
            "flex w-full items-center gap-1.5 rounded-[10px] px-2 text-left disabled:opacity-60",
            entry.subtitle ? "min-h-8 py-1" : "h-8",
            entry.rename && "pr-14",
            entry.active ? "bg-menu-active text-ink" : "text-ink hover:bg-menu-hover",
          )}
        >
          {entry.icon && <span data-menu-glyph="" className="menu-glyph">{entry.icon}</span>}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{entry.label}</span>
            {entry.subtitle && <span className="truncate text-[11.5px] leading-[14px] text-ink-secondary">{entry.subtitle}</span>}
          </span>
          {entry.value && <span className="shrink-0 tabular-nums text-ink-tertiary">{entry.value}</span>}
          {entry.trailing}
          {entry.checked && <Check size={16} aria-label="✓" className="shrink-0 text-ink" />}
        </button>
        {entry.rename && (
          <button
            type="button"
            data-rename-key={entry.key}
            title={entry.rename.label}
            aria-label={entry.rename.label}
            onClick={() => {
              // Stay in the menu: the row becomes the field (lot 6).
              entry.rename?.onRename();
            }}
            className="absolute right-8 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-ink-tertiary opacity-50 hover:bg-menu-hover hover:text-ink focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus group-hover/entry:opacity-100 touch:opacity-100"
          >
            <Pencil size={13} aria-hidden="true" />
          </button>
        )}
        </div>
      )}
    </div>
  );
}

/** The menu's hairline between groups: the reference's 0.5px line, 8px in
 * from the sides and 4px above and below (#4157). */
function MenuDivider() {
  return <div aria-hidden="true" className="menu-divider mx-2 my-1 h-[0.5px] shrink-0" />;
}

/** Opening is quick enough to feel like a hover, closing is slow enough to
 * forgive a diagonal path from the trigger to the menu. */
const OPEN_DELAY_MS = 80;
const CLOSE_DELAY_MS = 250;

export function SidebarPopoverMenu({
  tourId,
  items,
  ariaLabel,
  openOnHover = false,
  menuClassName = "left-0 right-0",
  placement = "above",
  banner,
  renderTrigger,
}: {
  /** A notice at the top of the menu, above its rows (the account menu's
   * waiting update, #4093); it gets `close` for its own button. */
  banner?: (close: () => void) => React.ReactNode;
  /** "above" stretches over the trigger's width and opens upward (the
   * sidebar's bottom menus); "below" hangs a fixed-width sheet under the
   * trigger's right edge (a header icon). */
  placement?: "above" | "below";
  /** `data-tour` id for the trigger button */
  tourId?: string;
  items: SidebarMenuItem[];
  ariaLabel: string;
  openOnHover?: boolean;
  /** horizontal placement of the menu; it spans the trigger by default, a
   * trigger narrower than its items (the avatar) gives it a width instead */
  menuClassName?: string;
  renderTrigger: (state: {
    open: boolean;
    attention: boolean;
    /** the loudest tone among the items asking for attention */
    attentionTone: "danger" | "accent";
  }) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinnedState] = useState(false);
  // the hover listeners are native and bound once, so they read the latest
  // pin and mode through refs rather than a stale render's closure
  const pinnedRef = useRef(false);
  const openOnHoverRef = useRef(openOnHover);
  openOnHoverRef.current = openOnHover;
  const setPinned = (value: boolean) => {
    pinnedRef.current = value;
    setPinnedState(value);
  };
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  // the second level open, by its item's key; it opens on hover after a
  // short wait and closes when the pointer settles on another row
  const [sub, setSub] = useState<string | null>(null);
  const subTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverSub = (key: string | null) => {
    if (subTimer.current) clearTimeout(subTimer.current);
    subTimer.current = setTimeout(() => setSub(key), key ? OPEN_DELAY_MS : CLOSE_DELAY_MS);
  };
  useEffect(() => () => { if (subTimer.current) clearTimeout(subTimer.current); }, []);
  useEffect(() => { if (!open) setSub(null); }, [open]);
  // The second level floats on the page (the sidebar clips what leaves it),
  // beside its row: fixed, placed from the row and from its own size each
  // time it opens, the window changes size or its rows change (#4157).
  const subRef = useRef<HTMLDivElement>(null);
  const [subAt, setSubAt] = useState<SubmenuPlace | null>(null);
  // the rows' part has more rows under its fold: it fades at the bottom
  const [subMore, setSubMore] = useState(false);
  // where the rows' part ends when they do not all fit: through a row
  const [subFold, setSubFold] = useState<number | null>(null);
  const placeSub = useRef<() => void>(() => {});
  placeSub.current = () => {
    if (!sub) return;
    const row = rootRef.current?.querySelector<HTMLElement>(`[data-menu-key="${CSS.escape(sub)}"]`);
    if (!row) return;
    const level = subRef.current;
    // its full height: the rows' part may already be capped and scrolling
    const rows = level?.querySelector<HTMLElement>("[data-submenu-rows]");
    const height = level ? level.offsetHeight + (rows ? rows.scrollHeight - rows.clientHeight : 0) : 0;
    const next = submenuPlace(
      row.getBoundingClientRect(),
      level ? { width: level.offsetWidth, height } : null,
      { width: window.innerWidth, height: window.innerHeight },
    );
    setSubAt((current) => (current && current.left === next.left && current.top === next.top && current.maxHeight === next.maxHeight ? current : next));
    setSubFold(level && rows ? measureRowsFold(level, rows, next.maxHeight) : null);
    setSubMore(rows ? moreBelow(rows) : false);
  };
  useLayoutEffect(() => {
    if (!sub) { setSubAt(null); setSubFold(null); return; }
    placeSub.current();
    const onResize = () => placeSub.current();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [sub, items]);
  // Once drawn, the level's own size decides where it fits; a ResizeObserver
  // reports before the frame is painted, so it never shows out of place.
  const subShown = subAt !== null;
  useLayoutEffect(() => {
    const level = subRef.current;
    if (!sub || !subShown || !level) return;
    placeSub.current();
    // the rows' fade follows their scroll
    const rows = level.querySelector<HTMLElement>("[data-submenu-rows]");
    const onScroll = () => { if (rows) setSubMore(moreBelow(rows)); };
    rows?.addEventListener("scroll", onScroll, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => placeSub.current());
    observer?.observe(level);
    return () => {
      rows?.removeEventListener("scroll", onScroll);
      observer?.disconnect();
    };
  }, [sub, subShown]);
  const dismissRef = useRef({
    contains: (target: unknown) => Boolean(
      (rootRef.current && rootRef.current.contains(target as Node)) || (subRef.current && subRef.current.contains(target as Node)),
    ),
  });
  const focusSub = (key: string) => {
    // the level is portaled to the page, outside the menu's root
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-submenu="${CSS.escape(key)}"] [role="menuitem"]:not([disabled])`)?.focus());
  };
  const motion = useMenuMotion(open);

  const [hover] = useState(() =>
    createHoverIntent({
      openDelayMs: OPEN_DELAY_MS,
      closeDelayMs: CLOSE_DELAY_MS,
      active: () => openOnHoverRef.current && !pinnedRef.current,
      setOpen,
    }),
  );
  const clearTimers = hover.cancel;
  useEffect(() => {
    const root = rootRef.current;
    return root ? bindHoverIntent(root, hover) : undefined;
  }, [hover]);

  const close = () => {
    clearTimers();
    setPinned(false);
    setOpen(false);
    setSub(null);
  };

  usePopoverDismiss(open, dismissRef, close);

  const asking = items.filter((item) => item.attention);
  const attention = asking.length > 0;
  // a failure outranks good news when both are folded away
  const attentionTone = asking.some((item) => item.attentionTone !== "accent") ? "danger" : "accent";

  return (
    <div
      ref={rootRef}
      className="relative"
      // hover is bound natively in the effect above (see sidebar-hover-intent)
      // a keyboard user tabbing in gets the same menu a pointer gets
      onFocus={() => {
        if (!openOnHover) return;
        clearTimers();
        setOpen(true);
      }}
      onBlur={(event) => {
        if (pinnedRef.current) return;
        if (!event.relatedTarget || !rootRef.current?.contains(event.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        data-tour={tourId}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        // A click leaves the trigger focused, and any key pressed afterwards
        // (an arrow, Escape) would make that focus :focus-visible and draw
        // the ring. The pointer mark (until blur or Tab) keeps it off;
        // keyboard focus still shows it (styles.css, [data-pointer-focus]).
        onPointerDown={(event) => { event.currentTarget.dataset.pointerFocus = ""; }}
        onKeyDown={(event) => { if (event.key === "Tab") delete event.currentTarget.dataset.pointerFocus; }}
        onBlur={(event) => { delete event.currentTarget.dataset.pointerFocus; }}
        onClick={() => {
          clearTimers();
          if (open && (pinned || !openOnHover)) close();
          else {
            setPinned(true);
            setOpen(true);
          }
        }}
        className="w-full"
      >
        {renderTrigger({ open, attention, attentionTone })}
      </button>

      {motion.shown && (
        <div
          id={menuId}
          role="menu"
          aria-label={ariaLabel}
          {...motion.exitProps}
          className={cn(
            // the reference's menu in the configuration the owner compares
            // (its typeface with 15px chat prose, #4093, #4157): 16px
            // corners, 6px padding, 32px rows 2px apart, 14/20 type, 10px
            // row corners; its fill, hairline and shadow are `.menu-surface`
            "absolute z-40 flex min-w-[200px] flex-col gap-0.5 rounded-2xl popover-surface menu-surface p-1.5 text-[14px] leading-5",
            placement === "below" ? "top-full right-0 mt-1 w-72 max-w-[calc(100vw-2rem)]" : cn("bottom-full mb-1", menuClassName),
            motion.className,
          )}
        >
          {banner?.(close)}
          {items.map((item) => (
            <div
              key={item.key}
              className={item.submenu ? "relative" : undefined}
              onPointerOver={() => { if (sub !== (item.submenu ? item.key : null)) hoverSub(item.submenu ? item.key : null); }}
            >
              {item.separatorBefore && <MenuDivider />}
              {item.heading && <div className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">{item.heading}</div>}
              <button
                type="button"
                role="menuitem"
                data-tour={item.tourId}
                data-menu-key={item.key}
                disabled={item.disabled}
                aria-haspopup={item.submenu ? "menu" : undefined}
                aria-expanded={item.submenu ? sub === item.key : undefined}
                onKeyDown={item.submenu ? (event) => {
                  if (event.key !== "ArrowRight") return;
                  event.preventDefault();
                  setSub(item.key);
                  focusSub(item.key);
                } : undefined}
                onClick={() => {
                  if (item.submenu) {
                    const next = sub === item.key ? null : item.key;
                    setSub(next);
                    if (next) focusSub(next);
                    return;
                  }
                  item.onSelect();
                  if (!item.keepOpen) close();
                }}
                className={cn(
                  "flex h-8 w-full items-center gap-1.5 rounded-[10px] px-2 text-left text-[14px] leading-5 disabled:opacity-60",
                  (item.subtitle || item.note) && "h-auto py-1.5",
                  item.active || (item.submenu && sub === item.key) ? "bg-menu-active text-ink" : "text-ink hover:bg-menu-hover",
                )}
              >
                {item.icon && <span data-menu-glyph="" className="menu-glyph">{item.icon}</span>}
                {item.subtitle || item.note ? (
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{item.label}</span>
                    {item.subtitle && <span className="truncate text-[12px] text-ink-secondary">{item.subtitle}</span>}
                    {item.note && <span className="text-[11.5px] leading-snug text-ink-tertiary">{item.note}</span>}
                  </span>
                ) : (
                  <span className="flex-1 truncate">{item.label}</span>
                )}
                {item.value && <span data-menu-value="" className="shrink-0 tabular-nums text-ink-tertiary">{item.value}</span>}
                {item.trailing}
                {item.attention && (
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      item.attentionTone === "accent" ? "bg-accent" : "bg-danger",
                    )}
                  />
                )}
                {item.submenu && <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-ink-tertiary" />}
              </button>
              {item.submenu && sub === item.key && subAt && createPortal(
                <div
                  ref={subRef}
                  role="menu"
                  aria-label={item.label}
                  data-submenu={item.key}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowLeft" && event.key !== "Escape") return;
                    event.preventDefault();
                    event.stopPropagation();
                    setSub(null);
                    rootRef.current?.querySelector<HTMLElement>(`[data-menu-key="${CSS.escape(item.key)}"]`)?.focus();
                  }}
                  data-sidebar
                  style={{ minWidth: item.submenuWidth ?? 180, ...subAt }}
                  className="fixed z-[70] flex w-max max-w-[min(400px,calc(100vw-24px))] flex-col gap-0.5 overflow-hidden rounded-2xl popover-surface menu-surface p-1.5 text-[14px] leading-5"
                >
                  <div
                    data-submenu-rows=""
                    data-more={subMore ? "below" : undefined}
                    style={subFold === null ? undefined : { maxHeight: subFold }}
                    className="menu-scroll flex min-h-0 flex-col gap-0.5 overflow-y-auto overscroll-contain"
                  >
                    {item.submenu.filter((entry) => !entry.foot).map((entry) => (
                      <SubmenuEntryRow key={entry.key} entry={entry} starSlot={hasStarSlot(item.submenu!)} onClose={close} />
                    ))}
                  </div>
                  {item.submenu.some((entry) => entry.foot) && (
                    // the card's foot stays in view: only the rows above scroll (#4157)
                    <div data-submenu-foot="" className="flex shrink-0 flex-col gap-0.5">
                      {/* the rows scroll above it: a hairline parts them from the foot */}
                      {subFold !== null && <MenuDivider />}
                      {item.submenu.filter((entry) => entry.foot).map((entry) => (
                        <SubmenuEntryRow key={entry.key} entry={entry} starSlot={hasStarSlot(item.submenu!)} onClose={close} />
                      ))}
                    </div>
                  )}
                </div>,
                document.body,
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
