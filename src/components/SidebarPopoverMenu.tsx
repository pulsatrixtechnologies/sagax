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
import { Check, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { bindHoverIntent, createHoverIntent } from "./sidebar-hover-intent";
import { useMenuMotion } from "./MenuMotion";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";

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
  /** a value in grey at the trailing edge, before the chevron (Grok Bot's
   * "Weekly usage · 100% used") */
  value?: string;
  /** a second level, opened to the right on hover, click or the right arrow
   * (Grok Bot's Usage ›, Support ›, Switch account ›); onSelect is unused */
  submenu?: SidebarSubmenuEntry[];
  /** where the second level lines up: the item's top (default) or, near the
   * bottom of the window, its bottom */
  submenuAlign?: "top" | "bottom";
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
  /** a check mark: the current choice (the organization in use) */
  checked?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  onSelect?: () => void;
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
  renderTrigger,
}: {
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
  // beside its row: fixed, measured from the row each time it opens.
  const subRef = useRef<HTMLDivElement>(null);
  const [subAt, setSubAt] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  useLayoutEffect(() => {
    if (!sub) { setSubAt(null); return; }
    const row = rootRef.current?.querySelector<HTMLElement>(`[data-menu-key="${CSS.escape(sub)}"]`);
    if (!row) return;
    const box = row.getBoundingClientRect();
    const item = items.find((entry) => entry.key === sub);
    // the row's top lines up with the level's first row (6px padding)
    setSubAt(item?.submenuAlign === "bottom"
      ? { left: box.right + 12, bottom: Math.max(8, window.innerHeight - box.bottom - 6) }
      : { left: box.right + 12, top: Math.max(8, box.top - 6) });
  }, [sub, items]);
  const dismissRef = useRef({
    contains: (target: unknown) => Boolean(
      (rootRef.current && rootRef.current.contains(target as Node)) || (subRef.current && subRef.current.contains(target as Node)),
    ),
  });
  const focusSub = (key: string) => {
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(`[data-submenu="${CSS.escape(key)}"] [role="menuitem"]:not([disabled])`)?.focus());
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
            "absolute z-40 flex min-w-[200px] flex-col gap-0.5 rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1.5 text-[13px] leading-[18px]",
            placement === "below" ? "top-full right-0 mt-1 w-72 max-w-[calc(100vw-2rem)]" : cn("bottom-full mb-1", menuClassName),
            motion.className,
          )}
        >
          {items.map((item) => (
            <div
              key={item.key}
              className={item.submenu ? "relative" : undefined}
              onPointerOver={() => { if (sub !== (item.submenu ? item.key : null)) hoverSub(item.submenu ? item.key : null); }}
            >
              {item.separatorBefore && <div className="mx-2 my-1 h-[0.5px] bg-border" />}
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
                  "flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-[13px] leading-[18px] disabled:opacity-60",
                  (item.subtitle || item.note) && "h-auto py-1.5",
                  item.active || (item.submenu && sub === item.key) ? "bg-selected text-ink" : "text-ink hover:bg-hover",
                )}
              >
                {item.icon && (
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center",
                      "text-ink",
                    )}
                  >
                    {item.icon}
                  </span>
                )}
                {item.subtitle || item.note ? (
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{item.label}</span>
                    {item.subtitle && <span className="truncate text-[12px] text-ink-secondary">{item.subtitle}</span>}
                    {item.note && <span className="text-[11.5px] leading-snug text-ink-tertiary">{item.note}</span>}
                  </span>
                ) : (
                  <span className="flex-1 truncate">{item.label}</span>
                )}
                {item.value && <span data-menu-value="" className="shrink-0 text-[13px] tabular-nums text-ink-tertiary">{item.value}</span>}
                {item.trailing}
                {item.attention && (
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      item.attentionTone === "accent" ? "bg-accent" : "bg-danger",
                    )}
                  />
                )}
                {item.submenu && <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-tertiary" />}
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
                  className="fixed z-[70] flex w-max max-w-[320px] flex-col gap-0.5 rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1.5 text-[13px] leading-[18px]"
                >
                  {item.submenu.map((entry) => (
                    <div key={entry.key}>
                      {entry.separatorBefore && <div className="mx-2 my-1 h-[0.5px] bg-border" />}
                      {entry.info ? (
                        <div data-submenu-info="" className="flex items-center gap-3 px-2 py-1.5">
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-ink">{entry.label}</span>
                            {entry.subtitle && <span className="truncate text-[12px] text-ink-secondary">{entry.subtitle}</span>}
                          </span>
                          {entry.value && <span className="shrink-0 tabular-nums text-ink-secondary">{entry.value}</span>}
                        </div>
                      ) : (
                        <button
                          type="button"
                          role="menuitem"
                          disabled={entry.disabled}
                          onClick={() => {
                            entry.onSelect?.();
                            close();
                          }}
                          className="flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-ink hover:bg-hover disabled:opacity-60"
                        >
                          {entry.icon && <span className="flex size-5 shrink-0 items-center justify-center">{entry.icon}</span>}
                          <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                          {entry.value && <span className="shrink-0 tabular-nums text-ink-tertiary">{entry.value}</span>}
                          {entry.trailing}
                          {entry.checked && <Check size={16} aria-label="✓" className="shrink-0 text-ink" />}
                        </button>
                      )}
                    </div>
                  ))}
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
