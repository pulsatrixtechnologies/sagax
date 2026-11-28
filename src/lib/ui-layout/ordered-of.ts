// Merge a saved zone order with the known default ids for that slice.
// An id absent from the saved order returns to its default place among known ids
// (D-20261127-004, #5443). Hidden ids stay out.

import type { ZoneLayout } from "./types";

/**
 * Insert each known id that is missing from `order` at its default place.
 * Dynamic ids (not in `known`) stay where they are. Hidden ids stay out.
 */
export function fillMissingAtDefault(
  order: readonly string[],
  hidden: readonly string[],
  known: readonly string[],
): string[] {
  const hiddenSet = new Set(hidden);
  const result = order.filter((id) => !hiddenSet.has(id));
  for (const id of known) {
    if (hiddenSet.has(id) || result.includes(id)) continue;
    const defaultIndex = known.indexOf(id);
    let insertAt = 0;
    for (let i = 0; i < defaultIndex; i++) {
      const prev = known[i];
      if (!prev || hiddenSet.has(prev)) continue;
      const at = result.indexOf(prev);
      if (at >= 0) insertAt = at + 1;
    }
    result.splice(insertAt, 0, id);
  }
  return result;
}

/**
 * Visible known ids only: saved relative order kept; any known id missing from
 * the saved order is inserted at its default place.
 */
export function orderedOf(zone: ZoneLayout, known: readonly string[]): string[] {
  const knownSet = new Set(known);
  return fillMissingAtDefault(zone.order, zone.hidden, known).filter((id) => knownSet.has(id));
}
