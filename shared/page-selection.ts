// Asking the bot about a selected passage of a page, in place (#4099): the
// app's own preview frame (never a reading link) tells the app where the
// person's selection is, so the app draws its outline, tag and small
// composer above the frame. The anchor is the one annotations use
// (shared/page-threads.ts PageQuote); the message to the bot carries it as
// `dataContext.page.selection` (shared/data-context.ts).
//
// One message, both ways:
// - frame -> app: `{ type, v: 1, anchor, rect }` when text is selected, and
//   again when the page scrolls or resizes; `{ type, v: 1, anchor: null }`
//   when the selection is gone (or its words are not found in this version).
// - app -> frame: `{ type, v: 1, anchor }` to follow that passage in the
//   version just drawn (the frame answers with its rectangle, or a clear);
//   `{ type, v: 1, anchor: null }` to drop the selection.
//
// The frame's scripts could forge it: the rectangle only places an overlay
// of the app, it carries no right and no content beyond the page's words.
import { parsePageQuote, type PageQuote } from "./page-threads.ts";

export const PAGE_SELECTION_MESSAGE = "sagax-page-selection";

/** The selection's box in the frame's viewport, in CSS pixels. */
export interface PageSelectionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the frame said: a selection with its box, or a clear. */
export type PageSelectionUpdate = { anchor: PageQuote; rect: PageSelectionRect } | { anchor: null };

/** Far outside any page the frame can draw: a coordinate past it is not one. */
const RECT_LIMIT = 1_000_000;

function coordinate(value: unknown, min: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= RECT_LIMIT ? Math.round(value) : null;
}

/** A selection message the frame posted, checked and cut, or null when it is
 * not one. Pure. */
export function parsePageSelectionMessage(data: unknown): PageSelectionUpdate | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  if (record.type !== PAGE_SELECTION_MESSAGE || record.v !== 1) return null;
  if (record.anchor === null) return { anchor: null };
  const anchor = parsePageQuote(record.anchor);
  const box = record.rect && typeof record.rect === "object" && !Array.isArray(record.rect) ? record.rect as Record<string, unknown> : null;
  if (!anchor || !box) return null;
  const x = coordinate(box.x, -RECT_LIMIT), y = coordinate(box.y, -RECT_LIMIT), w = coordinate(box.w, 0), h = coordinate(box.h, 0);
  if (x === null || y === null || w === null || h === null) return null;
  return { anchor, rect: { x, y, w, h } };
}

/** The message the app posts to its preview frame: follow this passage, or
 * drop the selection (null). Pure. */
export function pageSelectionRequest(anchor: PageQuote | null): { type: typeof PAGE_SELECTION_MESSAGE; v: 1; anchor: PageQuote | null } {
  return { type: PAGE_SELECTION_MESSAGE, v: 1, anchor };
}
