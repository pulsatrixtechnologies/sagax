// The mascot registry's families, and the arrow keys across a grid of mascot
// cells (the mascot picker, MascotPicker.tsx). The Appearance editor's filter
// chips and shelves lived here too, until the picker replaced them (#5369).

/** The families of the registry (mascots.tsx, mascot-catalog.ts), in order. */
export const MASCOT_FAMILIES = ["classics", "shapes", "animals"] as const;
export type MascotFamily = (typeof MASCOT_FAMILIES)[number];

/**
 * Arrow keys across the cells, read as rows of `columns`: left and right
 * step one cell, up and down one row (staying put at an edge), Home and End
 * jump to the ends. Null for any other key.
 */
export function wardrobeStep(index: number, count: number, columns: number, key: string): number | null {
  if (count === 0) return null;
  const last = count - 1;
  const across = Math.max(1, columns);
  if (key === "ArrowRight") return Math.min(index + 1, last);
  if (key === "ArrowLeft") return Math.max(index - 1, 0);
  if (key === "ArrowDown") return index + across <= last ? index + across : index;
  if (key === "ArrowUp") return index - across >= 0 ? index - across : index;
  if (key === "Home") return 0;
  if (key === "End") return last;
  return null;
}
