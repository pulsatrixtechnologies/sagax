// The category modal shell shared by Achievements, the persona editor and
// Browse Bots: a left column of categories (Browse Bots has none), a content
// pane, the close button top right, the Settings size. One set of classes
// and one keyboard so the modals look and behave the same.
import { useEffect, useRef, type RefObject } from "react";

import { cn } from "@/lib/cn";

export const CATEGORY_MODAL = {
  backdrop: "fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6",
  frame: "flex h-[min(700px,calc(100dvh-96px))] w-[min(900px,calc(100vw-40px))] overflow-hidden rounded-[14px] border border-border bg-app outline-none",
  nav: "hidden min-h-0 w-[198px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-hairline-weak bg-panel px-3 py-4 sm:flex",
  navTitle: "shrink-0 px-2 py-2 text-[13px] font-semibold text-ink",
  content: "relative flex min-h-0 min-w-0 flex-1 flex-col",
  close: "absolute right-2.5 top-2.5 z-10 flex size-8 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/10 hover:text-ink-secondary",
  mobileBar: "shrink-0 px-4 pb-1 pr-12 pt-3 sm:hidden",
  mobileSelect: "w-full min-w-0 rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink focus:border-border-strong focus:outline-none",
  pane: "flex flex-1 flex-col overflow-y-auto",
  heading: "hidden px-8 pb-1 pt-6 text-[17px] font-semibold leading-6 tracking-[-0.008em] text-ink sm:block",
  /** A pane's own title bar when there is no category select on a phone
   * (Browse Bots): the heading's type, shown at every width, clear of the
   * close button. */
  titleBar: "shrink-0 px-4 pb-3 pr-12 pt-6 sm:px-8",
  title: "text-[17px] font-semibold leading-6 tracking-[-0.008em] text-ink",
  body: "px-4 pb-6 pt-4 sm:px-8",
  /** The gray line under a title (Browse Bots, Connect apps). */
  subtitle: "mt-0.5 text-[13px] leading-[18px] text-ink-secondary",
  /** The filters, search and list of a browse pane (Browse Bots, Connect
   * apps): one set of sizes so the two read as one window. */
  toolbar: "shrink-0 px-4 sm:px-8",
  chips: "flex flex-wrap items-center gap-1.5",
  search: "flex min-w-0 flex-1 items-center gap-2.5 rounded-[14px] border border-transparent bg-hover px-4 py-2.5 focus-within:border-border-strong",
  searchInput: "min-w-0 flex-1 bg-transparent text-[13px] leading-[18px] text-ink placeholder:text-ink-secondary focus:outline-none",
  list: "min-h-0 px-4 pb-7 pt-4 sm:px-8",
  section: "mb-5",
  sectionHead: "mb-1.5 flex items-center justify-between gap-3",
  sectionTitle: "text-[13px] font-semibold text-ink",
  sectionLink: "text-[12px] text-ink-secondary hover:text-ink",
  grid: "grid grid-cols-1 gap-x-2 gap-y-0.5 md:grid-cols-2",
  /** A secondary button in a title bar or beside the search (Browse Bots,
   * N connected). */
  outlineButton: "flex shrink-0 items-center gap-2 rounded-[14px] border border-border px-3.5 py-2.5 text-[13px] leading-[18px] text-ink hover:bg-hover",
} as const;

/** A filter pill: the chosen one filled with the accent. */
export function categoryChipClass(active: boolean): string {
  return cn(
    "h-7 rounded-full border px-3 text-[12.5px] transition-colors motion-reduce:transition-none",
    active ? "border-transparent bg-accent text-accent-ink" : "border-border text-ink-secondary hover:bg-hover hover:text-ink",
  );
}

/** A row's button: Use, Connect, Add (primary); Open, Remove, Update
 * (secondary, outlined). */
export function cardActionClass(variant: "primary" | "secondary" | "quiet" = "primary"): string {
  return cn(
    "inline-flex shrink-0 items-center justify-center rounded-full px-3.5 py-1.5 text-[12.5px] font-medium leading-[18px] disabled:opacity-50",
    variant === "primary" ? "bg-ink text-app hover:opacity-90"
      : variant === "quiet" ? "bg-control text-ink hover:bg-raised-hover"
      : "border border-border text-ink hover:bg-hover",
  );
}

export function categoryNavItemClass(current: boolean): string {
  return cn(
    "flex items-center gap-[9px] rounded-lg px-[9px] py-[7px] text-left text-[13px] leading-[18px] text-ink transition-colors motion-reduce:transition-none",
    current ? "bg-selected" : "hover:bg-hover",
  );
}

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Same keyboard as Settings: focus moves in (to `initialFocus` when it is
 * visible), Escape closes, Tab stays in the dialog, and focus goes back
 * where it was on close. A key pressed outside the dialog (a popover
 * portaled to the body) and a visible dialog opened inside this one own
 * their own Escape. */
export function useCategoryModalKeyboard(
  dialogRef: RefObject<HTMLElement | null>,
  initialFocus: string,
  onClose: () => void,
) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const current = dialog?.querySelector<HTMLElement>(initialFocus);
    if (current?.checkVisibility()) current.focus();
    else dialog?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (dialog && event.target instanceof Node && event.target !== document.body && !dialog.contains(event.target)) return;
      if (event.key === "Escape") {
        const nested = dialog?.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
        if (nested && nested.getClientRects().length > 0) return;
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => element.checkVisibility());
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, [dialogRef, initialFocus]);
}

/** Up and Down (Home, End) walk a category list. Returns the next id, or null
 * for any other key. */
export function nextCategory<T>(ids: readonly T[], current: T, key: string): T | null {
  if (ids.length === 0) return null;
  const index = Math.max(0, ids.indexOf(current));
  const next =
    key === "ArrowDown" ? Math.min(index + 1, ids.length - 1)
      : key === "ArrowUp" ? Math.max(index - 1, 0)
        : key === "Home" ? 0
          : key === "End" ? ids.length - 1
            : -1;
  return next < 0 ? null : ids[next]!;
}
