// The record window's size and place (M-20261127-101, M-20261127-147): kept
// per person and per type of window (a ticket window, a company window, an
// invoice window of a product), in one preference that follows the person
// from device to device (`sagax.recordWindows.v1`, shared/user-preferences.ts).
// Beside the box, each type keeps where its split sits (the fields column's
// width, M-20261127-125) and, per table, the order and widths of its columns.
//
// The window never goes past the app's window (M-20261127-124): what is kept
// is the person's choice, what is shown is that choice bounded by the window
// of now, and a window too small never overwrites what is kept. Nothing kept
// yet: the window opens at the mockup's size (1240 px wide, the window's
// height less 48 px, 860 px at most), or at the size the person gave the
// opened card before this preference existed.
import { useSyncExternalStore } from "react";
import { MAX_PREFERENCE_VALUE } from "../../shared/user-preferences";

export type CardView = { width: number; height: number };

/** The least room between the window and the app's window's sides. */
export const RECORD_CARD_MARGIN = 16;
/** Under this the rows no longer read. A smaller app window still bounds the window. */
export const RECORD_CARD_MIN = { width: 480, height: 320 } as const;
/** The opened card's size on the device before this preference (#5053): read once as a type's first size. */
export const RECORD_CARD_WIDTH_KEY = "sagax.recordCard.width.v1";
export const RECORD_CARD_HEIGHT_KEY = "sagax.recordCard.height.v1";

/** Where a window nobody placed has its top: a little under the app window's top. */
export function recordCardTop(view: CardView): number {
  return Math.max(RECORD_CARD_MARGIN, Math.min(72, Math.round(view.height * 0.08)));
}

export const RECORD_WINDOWS_KEY = "sagax.recordWindows.v1";
/** The most types one person keeps; the oldest goes first. */
export const RECORD_WINDOW_TYPES_MAX = 40;
/** The most tables one type keeps the columns of. */
const GRIDS_MAX = 8;
/** The size a type of window opens at while nothing is kept (the mockup's, M-20261127-101). */
export const RECORD_WINDOW_DEFAULT = { width: 1240, height: 860, under: 48 } as const;
/** A kept number past this is not believed. */
const KEPT_MOST = 4000;

export interface RecordWindowBox { left: number; top: number; width: number; height: number }

export interface RecordGridKept {
  /** the columns' ids in the order the person put them */
  order?: string[];
  /** a column's width in px, by its id */
  widths?: Record<string, number>;
}

export interface RecordWindowKept {
  /** the width and height the person gave this type of window */
  w?: number;
  h?: number;
  /** where its top left corner sits */
  x?: number;
  y?: number;
  /** the width of its fields column (the split between the two sides) */
  split?: number;
  grids?: Record<string, RecordGridKept>;
}

type All = Record<string, RecordWindowKept>;

/** The type of window a record opens: one per product and kind. */
export function recordWindowType(ref: { product: string; kind: string }): string {
  return `${ref.product}/${ref.kind}`;
}

const store = (): Storage | undefined => {
  try { return globalThis.localStorage; } catch { return undefined; }
};
const kept = (value: unknown, min = 0): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= KEPT_MOST ? Math.round(value) : undefined;

function cleanGrid(raw: unknown): RecordGridKept | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const { order, widths } = raw as { order?: unknown; widths?: unknown };
  const out: RecordGridKept = {};
  if (Array.isArray(order)) out.order = order.filter((id): id is string => typeof id === "string" && /^[\w.-]{1,40}$/.test(id)).slice(0, 24);
  if (widths && typeof widths === "object" && !Array.isArray(widths)) {
    const sized: Record<string, number> = {};
    for (const [id, width] of Object.entries(widths as Record<string, unknown>).slice(0, 24)) {
      const px = kept(width, 40);
      if (px !== undefined && /^[\w.-]{1,40}$/.test(id)) sized[id] = px;
    }
    out.widths = sized;
  }
  return out.order?.length || Object.keys(out.widths ?? {}).length ? out : undefined;
}

/** One type's kept values, the ones that read. */
export function cleanKept(raw: unknown): RecordWindowKept {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const value = raw as Record<string, unknown>;
  const out: RecordWindowKept = {};
  const w = kept(value.w, RECORD_CARD_MIN.width), h = kept(value.h, RECORD_CARD_MIN.height);
  const x = kept(value.x), y = kept(value.y), split = kept(value.split, 120);
  if (w !== undefined) out.w = w;
  if (h !== undefined) out.h = h;
  if (x !== undefined && y !== undefined) { out.x = x; out.y = y; }
  if (split !== undefined) out.split = split;
  if (value.grids && typeof value.grids === "object" && !Array.isArray(value.grids)) {
    const grids: Record<string, RecordGridKept> = {};
    for (const [id, grid] of Object.entries(value.grids as Record<string, unknown>).slice(0, GRIDS_MAX)) {
      const clean = cleanGrid(grid);
      if (clean && /^[\w.-]{1,40}$/.test(id)) grids[id] = clean;
    }
    if (Object.keys(grids).length) out.grids = grids;
  }
  return out;
}

/** The whole preference as stored, every type cleaned. */
export function parseRecordWindows(raw: string | null | undefined): All {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: All = {};
    for (const [type, one] of Object.entries(value as Record<string, unknown>).slice(-RECORD_WINDOW_TYPES_MAX)) {
      if (!/^[a-z][a-z0-9_]{0,40}\/[a-z][a-z0-9_]{0,40}$/.test(type)) continue;
      const clean = cleanKept(one);
      if (Object.keys(clean).length) out[type] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

/** The preference written: the type just changed last (the oldest drop first), never past one preference's size. */
export function serializeRecordWindows(all: All): string {
  let types = Object.keys(all).slice(-RECORD_WINDOW_TYPES_MAX);
  let text = JSON.stringify(Object.fromEntries(types.map((type) => [type, all[type]])));
  while (text.length > MAX_PREFERENCE_VALUE && types.length > 1) {
    types = types.slice(1);
    text = JSON.stringify(Object.fromEntries(types.map((type) => [type, all[type]])));
  }
  return text;
}

let session: string | undefined;
const listeners = new Set<() => void>();
const readRaw = (): string | null => {
  if (session !== undefined) return session;
  try { return store()?.getItem(RECORD_WINDOWS_KEY) ?? null; } catch { return null; }
};
let cache: { raw: string | null; all: All } = { raw: null, all: {} };
function readAll(): All {
  const raw = readRaw();
  if (raw !== cache.raw) cache = { raw, all: parseRecordWindows(raw) };
  return cache.all;
}

/** The size the person gave the opened card before this preference (two numbers on the device). */
function legacySize(): { w?: number; h?: number } {
  try {
    const w = kept(Number(store()?.getItem(RECORD_CARD_WIDTH_KEY)), RECORD_CARD_MIN.width);
    const h = kept(Number(store()?.getItem(RECORD_CARD_HEIGHT_KEY)), RECORD_CARD_MIN.height);
    return { ...(w !== undefined ? { w } : {}), ...(h !== undefined ? { h } : {}) };
  } catch {
    return {};
  }
}

/** What one type of window keeps (a type never sized starts from the card's old size). */
export function readRecordWindow(type: string): RecordWindowKept {
  const one = readAll()[type];
  if (one && (one.w !== undefined || one.h !== undefined)) return one;
  return { ...legacySize(), ...one };
}

function notify() {
  for (const listener of listeners) listener();
}

function write(all: All) {
  const text = serializeRecordWindows(all);
  session = text;
  try {
    const local = store();
    local?.setItem(RECORD_WINDOWS_KEY, text);
    if (local?.getItem(RECORD_WINDOWS_KEY) === text) session = undefined;
  } catch {
    // the window still moves for this session when storage is refused
  }
  notify();
}

/** Keep a part of one type's values; `undefined` in the patch forgets that part. */
export function keepRecordWindow(type: string, patch: Partial<RecordWindowKept>): void {
  const all = { ...readAll() };
  const before = all[type] ?? {};
  const next: RecordWindowKept = { ...before };
  for (const [key, value] of Object.entries(patch) as Array<[keyof RecordWindowKept, unknown]>) {
    if (value === undefined) delete next[key];
    else (next as Record<string, unknown>)[key] = value;
  }
  delete all[type];
  const clean = cleanKept(next);
  if (Object.keys(clean).length) all[type] = clean;
  write(all);
}

/** Keep one table's columns for a type. */
export function keepRecordGrid(type: string, grid: string, value: RecordGridKept): void {
  const grids = { ...readAll()[type]?.grids };
  delete grids[grid];
  grids[grid] = value;
  const ids = Object.keys(grids);
  keepRecordWindow(type, { grids: Object.fromEntries(ids.slice(-GRIDS_MAX).map((id) => [id, grids[id]!])) });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== RECORD_WINDOWS_KEY && event.key !== null) return;
    session = undefined;
    listener();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** One type's kept values, followed live (this window, another one, another device). */
export function useRecordWindow(type: string): RecordWindowKept {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  void raw;
  return readRecordWindow(type);
}

/** The window of now, as the box is bounded by. */
export function recordWindowView(): CardView {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** The most room the window may take: the app's window less 16 px on every side. */
export function recordWindowRoom(view: CardView): CardView {
  return { width: Math.max(0, view.width - 2 * RECORD_CARD_MARGIN), height: Math.max(0, view.height - 2 * RECORD_CARD_MARGIN) };
}

/** The box shown: the kept size and place (else the default, centred), bounded by the window so no edge is ever past it. */
export function recordWindowBox(kept: RecordWindowKept, view: CardView): RecordWindowBox {
  const room = recordWindowRoom(view);
  const fallbackHeight = Math.max(RECORD_CARD_MIN.height, Math.min(RECORD_WINDOW_DEFAULT.height, view.height - RECORD_WINDOW_DEFAULT.under));
  const width = Math.max(0, Math.min(room.width, kept.w ?? RECORD_WINDOW_DEFAULT.width));
  const height = Math.max(0, Math.min(room.height, kept.h ?? fallbackHeight));
  const placed = kept.x !== undefined && kept.y !== undefined;
  const left = placed ? kept.x! : Math.round((view.width - width) / 2);
  const top = placed ? kept.y! : Math.min(recordCardTop(view), Math.max(RECORD_CARD_MARGIN, view.height - RECORD_CARD_MARGIN - height));
  return {
    width,
    height,
    left: Math.round(Math.min(Math.max(RECORD_CARD_MARGIN, left), Math.max(RECORD_CARD_MARGIN, view.width - RECORD_CARD_MARGIN - width))),
    top: Math.round(Math.min(Math.max(RECORD_CARD_MARGIN, top), Math.max(RECORD_CARD_MARGIN, view.height - RECORD_CARD_MARGIN - height))),
  };
}

/** HoverCard's `place` for a record window: the window places itself, from the top left of the app's window. */
export function placeRecordWindow(_card: CardView, view: CardView): { left: number; top: number; room: number } {
  return { left: 0, top: 0, room: view.height };
}
