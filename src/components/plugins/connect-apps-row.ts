// The control row of Connect Apps is ONE line at every width the window can
// have (the owner: "it should not be jumping line"). It adapts by shrinking,
// in this order: the search field narrows (down to SEARCH_MIN), then is an
// icon button that opens the field over the row (the filter and the sort stay
// beside it), then "+ Add" is a "+" icon button with its menu, then the filter
// and the sort leave the row and live inside the opened field. The kind tabs
// and "Yours | Discover" never shrink. The thresholds come from the real
// widths of the row's parts (measured in the DOM, French and English, with and
// without the update pill), never from a fixed guess.

export type RowLayout = "full" | "icon" | "compact" | "minimal";

/** The gap between the row's parts, and the separator with its margins. */
export const ROW_GAP = 10;
export const ROW_SEPARATOR = 9;
/** The narrowest the search field is allowed to be before it becomes an icon. */
export const SEARCH_MIN = 140;
/** The search as an icon button, and "+ Add" as a "+" icon button (its menu and its name stay). */
export const SEARCH_ICON = 32;
export const ADD_ICON = 32;
/** The chrome of "+ Add" around its label: the plus, the caret, the gaps, the padding. */
export const ADD_CHROME = 62;
/** "+ Add" with its label, before it has been measured. */
export const ADD_FALLBACK = 100;

export interface RowParts {
  /** the kind tabs */
  kinds: number;
  /** "Yours | Discover" */
  views: number;
  /** the "N updates" pill; 0 when there is none */
  update: number;
  /** the filter and the sort together; 0 when there are none */
  controls: number;
  /** "+ Add" with its label; 0 when there is none */
  addFull: number;
  /** whether the row has a search at all */
  search?: boolean;
}

const stack = (widths: readonly number[]) => {
  const shown = widths.filter((width) => width > 0);
  return shown.reduce((sum, width) => sum + width, 0) + ROW_GAP * Math.max(0, shown.length - 1);
};

/** The width each layout needs, in order (the first that fits the row is used). */
export function rowNeeds(parts: RowParts): Record<RowLayout, number> {
  const base = parts.kinds + ROW_SEPARATOR + parts.views + ROW_GAP * 3;
  const search = parts.search === false ? 0 : 1;
  const add = parts.addFull > 0 ? 1 : 0;
  return {
    full: base + stack([search ? SEARCH_MIN : 0, parts.update, parts.addFull]),
    icon: base + stack([parts.controls, search ? SEARCH_ICON : 0, parts.update, parts.addFull]),
    compact: base + stack([parts.controls, search ? SEARCH_ICON : 0, parts.update, add ? ADD_ICON : 0]),
    minimal: base + stack([search ? SEARCH_ICON : 0, parts.update, add ? ADD_ICON : 0]),
  };
}

export function rowLayout(width: number, parts: RowParts): RowLayout {
  const needs = rowNeeds(parts);
  return (["full", "icon", "compact"] as const).find((layout) => needs[layout] <= width) ?? "minimal";
}
