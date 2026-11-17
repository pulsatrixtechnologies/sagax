// A dropdown under a button that is never clipped (2026-11-17): rendered in a
// portal on the body, above the modal and every scroll area, placed from the
// trigger's box in the window's coordinates. It opens below the trigger and
// flips above it when the room below is short; it stays 8px inside the window
// on every side and follows the trigger when the list scrolls or the window
// resizes. The trigger's wrapper stays the dismiss root of the popover hook:
// `anchoredMenuRoot` makes a root that counts the portaled menu as inside it.
import { useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";

const GAP = 4;
const EDGE = 8;

export interface MenuPlace { left: number; top: number; flipped: boolean }

/** Where a menu of this size goes: under the trigger (aligned to its end or
 * start edge), or above it when it would run past the window's bottom and
 * there is more room above; always inside the window's margins. */
export function placeMenu(anchor: { left: number; right: number; top: number; bottom: number }, menu: { width: number; height: number }, view: { width: number; height: number }, align: "end" | "start"): MenuPlace {
  const below = view.height - anchor.bottom - GAP - EDGE;
  const above = anchor.top - GAP - EDGE;
  const flipped = menu.height > below && above > below;
  const top = flipped ? Math.max(EDGE, anchor.top - GAP - menu.height) : Math.min(anchor.bottom + GAP, Math.max(EDGE, view.height - menu.height - EDGE));
  const left = align === "end" ? anchor.right - menu.width : anchor.left;
  return { left: Math.max(EDGE, Math.min(left, view.width - menu.width - EDGE)), top, flipped };
}

/** The dismiss root of a trigger plus its portaled menu. */
export function anchoredMenuRoot(trigger: RefObject<HTMLElement | null>, menu: RefObject<HTMLElement | null>): { contains(target: unknown): boolean } {
  return { contains: (target) => Boolean(trigger.current?.contains(target as Node) || menu.current?.contains(target as Node)) };
}

export function AnchoredMenu({ anchor, menuRef, align = "end", point, className, style, children, ...rest }: {
  /** the trigger's wrapper */
  anchor: RefObject<HTMLElement | null>;
  menuRef?: RefObject<HTMLDivElement | null>;
  align?: "end" | "start";
  /** a right click: open at this window point instead of under the trigger */
  point?: { x: number; y: number } | null;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  role?: string;
  "aria-label"?: string;
  "data-item-menu"?: string;
}) {
  const own = useRef<HTMLDivElement | null>(null);
  const ref = menuRef ?? own;
  useLayoutEffect(() => {
    const element = ref.current;
    const trigger = anchor.current;
    if (!element || !trigger) return;
    const place = () => {
      const menu = element.getBoundingClientRect();
      const spot = placeMenu(point ? { left: point.x, right: point.x, top: point.y, bottom: point.y } : trigger.getBoundingClientRect(), { width: menu.width, height: menu.height }, { width: window.innerWidth, height: window.innerHeight }, align);
      element.style.left = `${spot.left}px`;
      element.style.top = `${spot.top}px`;
      element.setAttribute("data-menu-flipped", spot.flipped ? "" : "no");
      if (!spot.flipped) element.removeAttribute("data-menu-flipped");
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const watch = typeof ResizeObserver === "function" ? new ResizeObserver(place) : null;
    watch?.observe(element);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      watch?.disconnect();
    };
  });
  return createPortal(
    <div ref={ref} data-anchored-menu="" style={{ position: "fixed", left: 0, top: 0, ...style }} className={cn("z-[70]", className)} {...rest}>{children}</div>,
    document.body,
  );
}

/** Escape and an outside press close the menu; the trigger and the portaled menu both count as inside. */
export function useAnchoredDismiss(open: boolean, trigger: RefObject<HTMLElement | null>, menu: RefObject<HTMLElement | null>, close: () => void) {
  const root = useMemo(() => ({ current: anchoredMenuRoot(trigger, menu) }), [trigger, menu]);
  usePopoverDismiss(open, root, close);
}
