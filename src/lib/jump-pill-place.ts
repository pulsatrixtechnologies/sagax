// Where the "Jump to latest" pill goes so it never covers a chip of the
// transcript (2026-11-02: it was drawn over the "3 conversations with
// Katarina" chip). Centered by default; beside the chip it would cover when
// there is room on either side; hidden while it cannot clear the chip.
// Pure so the rule is testable without a layout engine.

export type PillRect = { left: number; top: number; right: number; bottom: number };

export type JumpPillPlace = { mode: "center" } | { mode: "beside"; left: number } | { mode: "hidden" };

export function placeJumpPill({
  pane,
  pill,
  obstacles,
  gap = 8,
}: {
  /** The pane the pill is centered in. */
  pane: { left: number; right: number };
  /** Where the pill sits when centered. */
  pill: PillRect;
  /** Chips the pill must not cover. */
  obstacles: readonly PillRect[];
  gap?: number;
}): JumpPillPlace {
  const width = pill.right - pill.left;
  const band = obstacles.filter((rect) => rect.bottom > pill.top - gap && rect.top < pill.bottom + gap);
  const hits = (left: number) => band.some((rect) => rect.right > left - gap && rect.left < left + width + gap);
  if (!hits(pill.left)) return { mode: "center" };
  const right = Math.max(...band.map((rect) => rect.right)) + gap;
  if (right + width <= pane.right - gap && !hits(right)) return { mode: "beside", left: right - pane.left };
  const left = Math.min(...band.map((rect) => rect.left)) - gap - width;
  if (left >= pane.left + gap && !hits(left)) return { mode: "beside", left: left - pane.left };
  return { mode: "hidden" };
}
