import { elementPath, type WireElement } from "./driver-wire.ts";

/** Matching live computer listings (apps, windows, elements) against what a recipe saved.
 * A leaf module: rules.ts and resolve.ts both read it, neither is read back. */
export type Match<T> = { ok: true; value: T } | { ok: false; reason: "none" | "ambiguous" };

type Kind = "string" | "number" | "boolean";
interface Shape { required: Record<string, Kind>; optional: Record<string, Kind>; id?: string }
interface LiveApp { pid: number; name: string; bundle_id?: string; running?: boolean }
interface LiveWindow { window_id: number; pid: number; title: string }

const APP: Shape = { required: { pid: "number", name: "string" }, optional: { bundle_id: "string", running: "boolean" } };
const WINDOW: Shape = { required: { window_id: "number", pid: "number", title: "string" }, optional: {}, id: "window_id" };
const ELEMENT: Shape = {
  required: { element_index: "number", role: "string", depth: "number" },
  optional: { element_token: "string", label: "string", parent_index: "number" },
  id: "element_index",
};

const NONE = { ok: false, reason: "none" } as const;
const AMBIGUOUS = { ok: false, reason: "ambiguous" } as const;

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function readEntry(item: unknown, shape: Shape): Record<string, unknown> | null {
  if (!isRecord(item)) return null;
  const entry: Record<string, unknown> = {};
  for (const [key, kind] of Object.entries(shape.required)) {
    if (typeof item[key] !== kind) return null;
    entry[key] = item[key];
  }
  for (const [key, kind] of Object.entries(shape.optional)) {
    const value = item[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== kind) return null;
    entry[key] = value;
  }
  return entry;
}

// Safety invariant: one unreadable entry or one repeated id makes the whole list unreadable.
// Skipping either could hide the second match that makes a target ambiguous.
function readList<T>(value: unknown, shape: Shape): T[] | null {
  if (!Array.isArray(value)) return null;
  const entries: T[] = [];
  const ids = new Set<unknown>();
  for (const item of value) {
    const entry = readEntry(item, shape);
    if (entry === null) return null;
    if (shape.id !== undefined) {
      if (ids.has(entry[shape.id])) return null;
      ids.add(entry[shape.id]);
    }
    entries.push(entry as T);
  }
  return entries;
}

function only<T>(candidates: readonly T[]): Match<T> {
  const [first, ...rest] = candidates;
  if (first === undefined) return NONE;
  return rest.length ? AMBIGUOUS : { ok: true, value: first };
}

export function matchApp(apps: unknown, app: { bundleId?: string; name?: string }): Match<number> {
  const list = readList<LiveApp>(apps, APP);
  const sameApp = app.bundleId ? (live: LiveApp) => live.bundle_id === app.bundleId : app.name ? (live: LiveApp) => live.name === app.name : null;
  if (!list || !sameApp) return NONE;
  return only(list.filter((live) => live.pid > 0 && live.running !== false && sameApp(live)).map((live) => live.pid));
}

export function matchWindow(windows: unknown, pid: number, window: { title: string }): Match<number> {
  const list = readList<LiveWindow>(windows, WINDOW);
  if (!list) return NONE;
  return only(list.filter((live) => live.pid === pid && live.title === window.title).map((live) => live.window_id));
}

const samePath = (path: readonly string[], saved: readonly string[]) => path.length === saved.length && path.every((part, index) => part === saved[index]);

export function matchElement(elements: unknown, element: { role: string; label: string; path: readonly string[] }): Match<WireElement> {
  const list = readList<WireElement>(elements, ELEMENT);
  if (!list) return NONE;
  const candidates = list
    .filter((live) => live.role === element.role && live.label === element.label)
    .map((live) => ({ live, path: elementPath(list, live) }))
    .filter(({ path }) => path === null || samePath(path, element.path));
  const match = only(candidates);
  if (!match.ok) return match;
  return match.value.path === null ? NONE : { ok: true, value: match.value.live };
}
