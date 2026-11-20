// The room a mascot's art leaves on its left inside its frame. Every
// character is drawn in a square with air around it, more for a shape (the
// round body with two eyes sits about 26px in at 160px) than for the owl
// (about 19px): the bot page's header measures it so the art's left edge,
// not its frame's, lines up with the first letter of the bot's name under
// it (the owner, M-20261119-081). Measured on what is drawn, so a new
// character or skin needs nothing here.
import { useLayoutEffect, useState, type RefObject } from "react";

/** What a mascot draws: SVG shapes and pictures (an HD character is an img). */
const DRAWN = "path, circle, ellipse, rect, polygon, polyline, line, image, use, img, canvas";

function drawnBox(el: Element): boolean {
  // a clip, mask or pattern's own geometry is never painted
  if (el.closest("defs, clipPath, mask, pattern, symbol")) return false;
  const check = (el as Element & { checkVisibility?: (options?: Record<string, boolean>) => boolean }).checkVisibility;
  if (typeof check === "function" && !check.call(el, { opacityProperty: true, visibilityProperty: true })) return false;
  return true;
}

/** The px between the frame's left edge and the leftmost drawn pixel box
 * inside it (0 when the art starts at the edge), or null while nothing is
 * drawn yet. */
export function drawnLeftInsetOrNull(frame: Element): number | null {
  const box = frame.getBoundingClientRect();
  let left = Infinity;
  for (const el of Array.from(frame.querySelectorAll(DRAWN))) {
    if (!drawnBox(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    left = Math.min(left, rect.left);
  }
  if (!Number.isFinite(left)) return null;
  return Math.max(0, Math.round(left - box.left));
}

/** drawnLeftInsetOrNull, 0 while nothing is drawn. */
export function drawnLeftInset(frame: Element): number {
  return drawnLeftInsetOrNull(frame) ?? 0;
}

/** The frame's inset, measured when the art is first drawn (before paint,
 * so in its resting pose: the owl turns its head and a shape breathes a few
 * px once their idle moves start) and again when `look` changes. Art that
 * paints late (a shape's engine, a picture) is waited for, a few frames. */
export function useDrawnLeftInset(frameRef: RefObject<HTMLElement | null>, look: unknown): number {
  const [inset, setInset] = useState(0);
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const timers: number[] = [];
    const measure = (left: readonly number[]) => {
      const found = drawnLeftInsetOrNull(frame);
      if (found !== null) { setInset(found); return; }
      const [next, ...rest] = left;
      if (next !== undefined) timers.push(window.setTimeout(() => measure(rest), next));
    };
    measure([50, 150, 400, 1000]);
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [frameRef, look]);
  return inset;
}
