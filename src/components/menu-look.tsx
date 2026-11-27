// The menu family's one look (#4157, #4183): the surface and the row every
// menu of the app draws, the account menu (SidebarPopoverMenu), the
// header's conversation menu (ThreadMenu) and the rows' and cards' three
// dots menus alike. The reference's override is on its root, so every menu
// takes the same values, measured in the owner's configuration and written
// in docs/design/ux-reference-grokbot-cursor.md (Account menu): 16px
// corners, 6px padding, 32px rows 2px apart with 8px inside each side, 6px
// from the glyph to the text, 14/20 type, 10px row corners. The colours
// (fill, hairline, shadow, glyph ink, hovered and current rows) live once,
// in src/styles.css: `.menu-surface`, `.menu-glyph`, `.menu-divider` and the
// `bg-menu-hover` / `bg-menu-active` utilities. A menu takes these
// constants; it never writes its own copy of the values.
import { useLayoutEffect, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/cn";

/** The menu's box: worn with its own placement (fixed, absolute, width). */
export const MENU_SURFACE = "flex flex-col gap-0.5 rounded-2xl popover-surface menu-surface p-1.5 text-[14px] leading-5";

/** The menu family's box alone (surface fill, hairline, shadow, 16px
 * corners), for a popover that lays out its own inside: the composer's "/"
 * and "@" lists, the model menus, the memes picker. A menu with rows takes
 * MENU_SURFACE, which adds the rows' padding and gap on top of it. */
export const MENU_BOX = "rounded-2xl popover-surface menu-surface";

/** What a popover opened from the composer keeps from the composer's top
 * edge: 4px, the account menu's gap from its trigger (POPOVER_GAP). The
 * anchors (+, model chip, mode chip) sit 10px inside the capsule, so an
 * anchor-relative offset adds that inset. */
export const COMPOSER_POPOVER_GAP = 4;
export const COMPOSER_ANCHOR_INSET = 10;
/** Offset from an anchor inside the capsule (px) and its class. */
export const COMPOSER_POPOVER_RISE = COMPOSER_POPOVER_GAP + COMPOSER_ANCHOR_INSET;
export const COMPOSER_POPOVER_RISE_CLASS = "mb-3.5";
/** Offset from the capsule itself (the "/" and "@" lists). */
export const COMPOSER_LIST_RISE_CLASS = "mb-1";

/** The menu's width: its content's, as the account menu sizes itself, up
 * to 400px and never past the window's 8px gutters (useMenuInWindow), so no
 * label is cut in any language. A row menu adds its 228px floor. */
export const MENU_FIT = "w-max max-w-[min(400px,calc(100vw-16px))]";

/** A row menu's width: MENU_FIT over a 228px floor, which gives way in a
 * window narrower than that. */
export const MENU_FIT_ROW = cn(MENU_FIT, "min-w-[min(228px,calc(100vw-16px))]");

/** A submenu overlaps its row's trailing edge by 4px (the reference's
 * offset, #4157). Negative: the next level sits 4px over the row. */
export const SUBMENU_SIDE_OFFSET = -4;

/** A row's shape: 32px, 8px inside each side, 6px from the glyph, 10px
 * corners. A row with a second line adds `h-auto py-1.5`. A disabled row
 * dims in src/styles.css (`.menu-surface` rows). */
export const MENU_ROW_SHAPE = "flex h-8 w-full shrink-0 items-center gap-1.5 rounded-[10px] px-2 text-left text-[14px] leading-5";

/** A row in the primary ink, hovered (or keyboard focused) at 6% of it. */
export const MENU_ROW = cn(MENU_ROW_SHAPE, "text-ink hover:bg-menu-hover focus-visible:bg-menu-hover");

/** The open or current row: 8% of the ink. */
export const MENU_ROW_ACTIVE = cn(MENU_ROW_SHAPE, "bg-menu-active text-ink");

/** A row that deletes or ends something: the danger ink, the same fills. */
export const MENU_ROW_DANGER = cn(MENU_ROW_SHAPE, "text-danger hover:bg-menu-hover focus-visible:bg-menu-hover");

/** The row for its tone. */
export function menuRow(tone: "idle" | "active" | "danger" = "idle"): string {
  return tone === "active" ? MENU_ROW_ACTIVE : tone === "danger" ? MENU_ROW_DANGER : MENU_ROW;
}

/** A row's glyph: 16px in the 18px slot, a 1.5 stroke, in the glyph ink
 * (the danger ink on a danger row, the accent on a mode that is on). */
export function MenuGlyph({ children, danger, active }: { children: ReactNode; danger?: boolean; active?: boolean }) {
  return <span data-menu-glyph="" aria-hidden="true" className={cn("menu-glyph", danger && "text-danger", active && "text-accent")}>{children}</span>;
}

/** The hairline between groups: 0.5px, 8px in from the sides, 4px above
 * and below. */
export function MenuDivider(data: { [marker: `data-${string}`]: string | undefined }) {
  return <div role="separator" {...data} className="menu-divider mx-2 my-1 h-[0.5px] shrink-0" />;
}

/** Where a menu was asked to open: its top left corner, or with `right` its
 * top right corner (a menu under a "..." at the right edge of its row). */
export type MenuPoint = { left: number; top: number; right?: boolean };

/** Keeps an open fixed menu inside the window with its measured size, 8px
 * from each edge. A menu sizes to its content (MENU_FIT), so a long name or
 * a French label makes it wider than its 228px floor: placing it with a
 * guessed width let it run past the window's right edge and cut its text.
 * Near the bottom it opens upward when that side has more room; near the
 * right edge it stays left of the point (`right: true` keeps the menu's
 * right edge on the point). Runs after every render, before paint (the rows
 * change with the locale, permissions and the page shown), and again when
 * the window resizes. */
export function useMenuInWindow(ref: RefObject<HTMLElement | null>, at: MenuPoint | null | undefined | false): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !at) return;
    const place = () => {
      const { width, height } = element.getBoundingClientRect();
      const edge = 8;
      const viewW = window.innerWidth;
      const viewH = window.innerHeight;
      const roomBelow = viewH - at.top - edge;
      const roomAbove = at.top - edge;
      // Prefer the side with more room when the menu would leave the window.
      // Always clamp afterward so a short window or an off-screen anchor still
      // keeps every edge inside (tests and tiny viewports).
      const flipUp = height > roomBelow && roomAbove > roomBelow;
      const top = Math.max(edge, Math.min(flipUp ? at.top - height : at.top, viewH - height - edge));
      const left = at.right ? at.left - width : at.left;
      element.style.top = `${top}px`;
      element.style.left = `${Math.max(edge, Math.min(left, viewW - width - edge))}px`;
      if (typeof element.setAttribute === "function") {
        if (flipUp) element.setAttribute("data-menu-flipped", "");
        else element.removeAttribute("data-menu-flipped");
      }
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  });
}
