// Whole rows only (#4507). A hovered card never clips through a row: of the
// rows of a pane, as many as fit show whole and a quiet "N more" says how many
// were left out. Pure functions, so the rule is tested without a browser; the
// DOM pass (RecordCard.tsx Pane) only measures and applies them.

export interface FitInput {
  /** each row's bottom edge, in the pane's own coordinates, in order */
  bottoms: readonly number[];
  /** the lowest bottom a row may have when nothing is left out */
  full: number;
  /** the lowest bottom a row may have when the "N more" line is shown: the
   * line's height is reserved whenever at least one row is hidden */
  partial: number;
}

/** How many rows show: all of them when the last one fits; else the rows
 * that end above the room kept for the "N more" line (possibly none). */
export function fitRows({ bottoms, full, partial }: FitInput): number {
  if (!bottoms.length) return 0;
  if (bottoms[bottoms.length - 1]! <= full) return bottoms.length;
  let shown = 0;
  while (shown < bottoms.length && bottoms[shown]! <= partial) shown += 1;
  return shown;
}

/** Bottom edges of rows `heights` tall, `gap` apart, the first starting at `start`. */
export function bottomsOf(heights: readonly number[], gap = 0, start = 0): number[] {
  const out: number[] = [];
  let at = start;
  for (const height of heights) {
    at += height;
    out.push(at);
    at += gap;
  }
  return out;
}

/** What the rows left out are: key fields when all of them are, lines of the
 * list when all of them are, else rows. */
export type MoreKind = "field" | "line" | "row";

export function moreKind(hiddenKeys: readonly string[]): MoreKind {
  if (hiddenKeys.length > 0 && hiddenKeys.every((key) => key.startsWith("f-field-"))) return "field";
  if (hiddenKeys.length > 0 && hiddenKeys.every((key) => /^l-\d/.test(key))) return "line";
  return "row";
}
