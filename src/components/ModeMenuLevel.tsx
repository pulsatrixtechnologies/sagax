// One level of the mode menu's cascade (#5338; owner 2026-11-25,
// M-20261125-035, D-20261125-012): the menu stays on screen and each level
// opens beside the row that opened it (Reasoning's levels; All models'
// providers, then a provider's accounts, then an account's models), so the
// whole path reads at once. The level floats on the page (the menu's box
// clips what leaves it) and is placed by the menu family's one submenu
// positioner (SidebarPopoverMenu's submenuPlace): beside its row, flipped to
// the row's other side when the window has no room, and a level opened from
// another keeps going the way the first one went so it never covers the menu. The
// first level of a path picks the side for the whole path: the left when the
// right cannot hold every level that may open from it and the left has more
// room.
import { useEffect, useLayoutEffect, useRef, type KeyboardEventHandler, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";
import { POPOVER_LAYER } from "./AnchoredPopover";
import { MENU_BOX } from "./menu-look";
import { submenuPlace } from "./SidebarPopoverMenu";

/** The level's own padding above its first row: the row lines up with the one that opened it. */
const LEVEL_PAD = 4;

export interface ModeMenuLevelProps {
  /** Which level this is (`reasoning`, `providers`, `accounts`, `models`). */
  level: string;
  /** The row that opened it, as a selector. */
  anchor: string;
  label: string;
  /** The width the whole path that may open from this level takes (its own and the levels after it). */
  room?: number;
  /** Opened by a click or a key: the focus moves into it. A hover leaves the focus where it is. */
  focus: boolean;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
  /** The pointer came in: a pending close is dropped. */
  onPointerEnter: () => void;
  children: ReactNode;
}

export function ModeMenuLevel({ level, anchor, label, room = 0, focus, onKeyDown, onPointerEnter, children }: ModeMenuLevelProps) {
  const ref = useRef<HTMLDivElement>(null);

  // placed before every paint: the row that opened it moves when its own level is placed or scrolls
  useLayoutEffect(() => {
    const place = () => {
      const node = ref.current;
      const row = document.querySelector<HTMLElement>(anchor);
      if (!node || !row) return;
      // beside the box that holds the row (the menu, or the level before), level with the row
      const box = (row.closest<HTMLElement>("[data-model-menu]") ?? row).getBoundingClientRect();
      const top = row.getBoundingClientRect().top;
      node.style.maxHeight = "";
      const from = row.closest<HTMLElement>("[data-mode-level]");
      const right = window.innerWidth - box.right;
      const left = from ? from.dataset.side === "left" : right < room && box.left > right;
      const next = submenuPlace(
        { left: box.left, right: box.right, top: top - LEVEL_PAD },
        { width: node.offsetWidth, height: node.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        left ? "left" : from ? "right" : undefined,
      );
      node.style.left = `${next.left}px`;
      node.style.top = `${next.top}px`;
      node.style.maxHeight = `${next.maxHeight}px`;
      node.dataset.side = next.left < box.left ? "left" : "right";
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const observer = typeof ResizeObserver === "undefined" || !ref.current ? null : new ResizeObserver(place);
    if (ref.current) observer?.observe(ref.current);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      observer?.disconnect();
    };
  });

  // the focus lands on the search field of a long list, else the choice in use, else the first row
  useEffect(() => {
    if (!focus) return;
    const node = ref.current;
    (node?.querySelector<HTMLElement>("[data-model-panel-search]")
      ?? node?.querySelector<HTMLElement>('[data-model-panel-row][aria-checked="true"]:not([disabled])')
      ?? node?.querySelector<HTMLElement>("[data-model-panel-row]:not([disabled])"))?.focus({ preventScroll: true });
  }, [focus]);

  const element = (
    // data-model-menu: a press in a level is a press in the model menu (the composer's and the picker's outside checks)
    <div ref={ref} data-mode-level={level} data-model-menu="" role="group" aria-label={label}
      onKeyDown={onKeyDown} onPointerEnter={onPointerEnter}
      className={cn("fixed left-0 top-0 flex w-max min-w-[min(180px,calc(100vw-24px))] max-w-[min(300px,calc(100vw-24px))] flex-col overflow-hidden py-1 text-popover-ink", POPOVER_LAYER, MENU_BOX)}>
      {children}
    </div>
  );
  // server rendering (the static-markup tests) has no body to portal into
  return typeof document === "undefined" ? element : createPortal(element, document.body);
}
