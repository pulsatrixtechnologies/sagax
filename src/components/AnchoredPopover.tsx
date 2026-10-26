// The one place a dropdown, menu or popover that hangs off a trigger is drawn
// when it must not be cut by a parent. An `absolute` menu inside a card, a
// settings group or a scroll area is clipped by that ancestor's `overflow`
// (JC 2026-10-22: the "Discuter" level menu was cut off inside its card).
// This renders the menu through a portal into <body>, `position: fixed`
// against the trigger, so no ancestor clips it; it flips above the trigger
// when there is more room there, shifts to stay inside the window, and
// follows the trigger on resize and on scroll of any ancestor.
//
// Dismiss: pass `containsRef` to usePopoverDismiss via `useAnchoredDismissRoot`
// so a press inside the portalled menu is not an "outside" press.
import { createElement, useLayoutEffect, useMemo, useRef, type CSSProperties, type KeyboardEventHandler, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { placeAnchored, type PopoverAlign, type PopoverSide } from "@/lib/anchored-placement";

/** Above dialogs (z-50) and sidebars; below the guided tour card. */
export const POPOVER_LAYER = "z-[70]";

type Containing = { contains(target: unknown): boolean };

/** A dismiss root that covers both the trigger's wrapper and the portalled
 * menu (which is no longer inside it in the DOM). */
export function useAnchoredDismissRoot(
  triggerRoot: RefObject<Containing | null>,
  popover: RefObject<Containing | null>,
): RefObject<Containing | null> {
  return useMemo(
    () => ({
      get current(): Containing {
        return {
          contains: (target: unknown) => Boolean(triggerRoot.current?.contains(target) || popover.current?.contains(target)),
        };
      },
    }) as RefObject<Containing | null>,
    [triggerRoot, popover],
  );
}

export function AnchoredPopover({
  anchorRef,
  popoverRef,
  as = "div",
  side = "bottom",
  align = "start",
  gap = 4,
  maxHeight,
  className,
  style,
  children,
  onKeyDown,
  ...aria
}: {
  anchorRef: RefObject<HTMLElement | null>;
  /** The menu's own element, for focus, measuring and outside-press checks. */
  popoverRef?: RefObject<HTMLElement | null>;
  as?: "div" | "ul";
  side?: PopoverSide;
  align?: PopoverAlign;
  gap?: number;
  /** The most the menu may take, in px, even when there is more room. */
  maxHeight?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  id?: string;
  role?: string;
  "aria-label"?: string;
}) {
  const own = useRef<HTMLElement | null>(null);
  const ref = popoverRef ?? own;

  useLayoutEffect(() => {
    const place = () => {
      const node = ref.current;
      const anchor = anchorRef.current;
      if (!node || !anchor) return;
      node.style.maxHeight = maxHeight ? `${maxHeight}px` : "";
      const box = node.getBoundingClientRect();
      const result = placeAnchored({
        anchor: anchor.getBoundingClientRect(),
        size: { width: box.width, height: box.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        align,
        side,
        gap,
      });
      node.style.top = `${Math.round(result.top)}px`;
      node.style.left = `${Math.round(result.left)}px`;
      node.style.maxHeight = `${Math.floor(maxHeight ? Math.min(maxHeight, result.maxHeight) : result.maxHeight)}px`;
      node.dataset.side = result.side;
    };
    place();
    window.addEventListener("resize", place);
    // Capture: a scroll on any ancestor (not only the window) moves the trigger.
    window.addEventListener("scroll", place, true);
    const resize = typeof ResizeObserver === "function" && ref.current ? new ResizeObserver(place) : null;
    if (resize && ref.current) resize.observe(ref.current);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      resize?.disconnect();
    };
  }, [anchorRef, ref, align, side, gap, maxHeight]);

  const element = createElement(
    as,
    {
      ...aria,
      ref,
      onKeyDown,
      "data-anchored-popover": "",
      className: `fixed left-0 top-0 ${POPOVER_LAYER} ${className ?? ""}`,
      style,
    },
    children,
  );
  // Server rendering (the static-markup tests) has no body to portal into.
  return typeof document === "undefined" ? element : createPortal(element, document.body);
}
