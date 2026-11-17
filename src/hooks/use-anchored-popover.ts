// Keeps a popover drawn in a portal (fixed, on document.body) next to its
// anchor: placed before the first paint, then again whenever anything
// scrolls, the window changes size or the popover itself does (a search in
// the reaction picker). The placement rules live in src/lib/popover-placement.ts.
// While its anchor is scrolled out of the container that shows it (a
// message out of the transcript's view), the popover is hidden rather than
// left floating over the header or the composer.
import { useLayoutEffect, type RefObject } from "react";

import { placePopover } from "@/lib/popover-placement";

/** The nearest ancestor that scrolls vertically, if any. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return null;
}

export function useAnchoredPopover(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  popupRef: RefObject<HTMLElement | null>,
  { prefer, align, gap }: { prefer: "above" | "below"; align: "start" | "end"; gap?: number },
) {
  useLayoutEffect(() => {
    if (!open) return;
    const anchorAtOpen = anchorRef.current;
    const scroller = anchorAtOpen ? scrollParent(anchorAtOpen) : null;
    const place = () => {
      const anchor = anchorRef.current;
      const popup = popupRef.current;
      if (!anchor || !popup) return;
      const box = anchor.getBoundingClientRect();
      const shown = scroller?.getBoundingClientRect();
      const away = Boolean(shown && (box.bottom <= shown.top || box.top >= shown.bottom));
      popup.style.visibility = away ? "hidden" : "";
      // offset sizes, not the box: the opening pop scales the popover; the
      // full height, even while a max height makes it scroll inside
      const height = popup.scrollHeight + (popup.offsetHeight - popup.clientHeight);
      const rtl = getComputedStyle(anchor).direction === "rtl";
      const edge = (align === "end") !== rtl ? "right" : "left";
      const view = { width: window.innerWidth, height: window.visualViewport?.height ?? window.innerHeight };
      const spot = placePopover(box, { width: popup.offsetWidth, height }, view, { prefer, edge, gap });
      popup.style.left = `${spot.left}px`;
      popup.style.top = `${spot.top}px`;
      const maxHeight = spot.maxHeight === undefined ? "" : `${spot.maxHeight}px`;
      if (popup.style.maxHeight !== maxHeight) popup.style.maxHeight = maxHeight;
      popup.dataset.side = spot.side;
    };
    // a scroll inside the popover (the picker's grid) moves nothing
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && popupRef.current?.contains(event.target)) return;
      place();
    };
    place();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    if (popupRef.current) observer?.observe(popupRef.current);
    if (anchorRef.current) observer?.observe(anchorRef.current);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
      observer?.disconnect();
    };
  }, [open, anchorRef, popupRef, prefer, align]);
}
