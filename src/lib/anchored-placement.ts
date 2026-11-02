// Where a popover that floats over the whole window goes, relative to the
// trigger it belongs to: under it (or over it), aligned to one edge, then
// flipped to the roomier side and shifted so it never leaves the viewport.
// Pure so the rules are testable without a layout engine.

export type PlacementRect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
export type PopoverSide = "bottom" | "top";
export type PopoverAlign = "start" | "end" | "center";

export type AnchoredPlacement = {
  top: number;
  left: number;
  /** The side it finally opened on (after a flip). */
  side: PopoverSide;
  /** The height the popover may take on that side; scroll inside beyond it. */
  maxHeight: number;
};

/** The box the popover must stay inside (a window drawn over the app, such
 * as Settings); the viewport when left out. */
export type PlacementBounds = { left: number; top: number; right: number; bottom: number };

export function placeAnchored({
  anchor,
  size,
  viewport,
  align = "start",
  side = "bottom",
  gap = 4,
  margin = 8,
  bounds,
}: {
  anchor: PlacementRect;
  size: { width: number; height: number };
  viewport: { width: number; height: number };
  align?: PopoverAlign;
  side?: PopoverSide;
  gap?: number;
  margin?: number;
  bounds?: PlacementBounds;
}): AnchoredPlacement {
  const box = {
    left: Math.max(0, bounds?.left ?? 0),
    top: Math.max(0, bounds?.top ?? 0),
    right: Math.min(viewport.width, bounds?.right ?? viewport.width),
    bottom: Math.min(viewport.height, bounds?.bottom ?? viewport.height),
  };
  const below = box.bottom - anchor.bottom - gap - margin;
  const above = anchor.top - box.top - gap - margin;
  const wanted = side === "bottom" ? below : above;
  const other = side === "bottom" ? above : below;
  // Keep the preferred side while it fits (or is at least as roomy).
  const finalSide: PopoverSide = size.height <= wanted || wanted >= other ? side : side === "bottom" ? "top" : "bottom";
  const room = Math.max(0, finalSide === "bottom" ? below : above);
  const height = Math.min(size.height, room);
  const top = finalSide === "bottom" ? anchor.bottom + gap : anchor.top - gap - height;

  let left = align === "end" ? anchor.right - size.width : align === "center" ? anchor.left + anchor.width / 2 - size.width / 2 : anchor.left;
  left = Math.min(left, box.right - size.width - margin);
  left = Math.max(left, box.left + margin);
  return { top, left, side: finalSide, maxHeight: room };
}
