import type { WheelEvent } from "react";

/** A plain mouse wheel only scrolls vertically. Over a horizontal tab row
 * that is too narrow for its tabs, this turns that vertical wheel into a
 * sideways scroll of the row, so every tab is reachable without a trackpad
 * or the Shift key. It acts only when the row overflows and the gesture is
 * mostly vertical; a sideways gesture the browser already handles, and a row
 * that fits, are left alone. No preventDefault: React's wheel listeners are
 * passive, and nothing behind the row scrolls. */
export function scrollTabsWithWheel(event: WheelEvent<HTMLElement>): void {
  const row = event.currentTarget;
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || row.scrollWidth <= row.clientWidth) return;
  row.scrollLeft += event.deltaY;
}
