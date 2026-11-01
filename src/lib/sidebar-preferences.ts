import { useSyncExternalStore } from "react";
import { z } from "zod";

export type SidebarDensity = "comfortable" | "compact" | "icons";

export const SIDEBAR_DENSITIES: readonly SidebarDensity[] = ["comfortable", "compact", "icons"];

export const SIDEBAR_DENSITY_KEY = "openmausbot.sidebarDensity";
export const SIDEBAR_WIDTH_KEY = "openmausbot.sidebarWidth";
export const SIDEBAR_ATTENTION_PINNED_KEY = "openmausbot.sidebarAttentionPinned.v1";
export const SIDEBAR_COLLAPSED_SECTIONS_KEY = "openmausbot.sidebarCollapsedSections.v1";
export const SIDEBAR_SECTION_ORDER_KEY = "openmausbot.sidebarSectionOrder.v1";
/** The density to return to when the collapsed (icons) sidebar is expanded
 * again by dragging or double-clicking its edge. */
export const SIDEBAR_EXPANDED_DENSITY_KEY = "openmausbot.sidebarExpandedDensity.v1";
export const PINNED_CIRCLES_KEY = "openmausbot.pinnedCircles";
export const UNIVERSAL_PINS_KEY = "openmausbot.universalPins";

export function parseSidebarDensity(value: string | null): SidebarDensity {
  switch (value) {
    case "comfortable":
    case "compact":
    case "icons":
      return value;
    default:
      return "comfortable";
  }
}

export function loadSidebarDensity(storage?: Pick<Storage, "getItem"> | null): SidebarDensity {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    return parseSidebarDensity(target?.getItem(SIDEBAR_DENSITY_KEY) ?? null);
  } catch {
    return "comfortable";
  }
}

export function saveSidebarDensity(
  density: SidebarDensity,
  storage?: Pick<Storage, "setItem"> | null,
): void {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    target?.setItem(SIDEBAR_DENSITY_KEY, density);
  } catch {
    // Private browsing and locked-down webviews may reject localStorage.
    // The in-memory React state still makes the control useful this session.
  }
}

/** Collapse or expand the sidebar (its edge's drag and double-click, ⌘B): icons
 * density is the collapsed rail, like Perspicax's narrow sidebar. Collapsing remembers the density it left so
 * expanding lands back on comfortable or compact, whichever it was.
 * On the automatic rail (a medium-width window) the window decides, so the
 * live toggle leaves the person's density as it is and returns it. */
export function toggleSidebarCollapsed(
  storage?: Pick<Storage, "getItem" | "setItem"> | null,
): SidebarDensity {
  if (storage === undefined && currentSidebarViewport() === "medium") return currentSidebarDensity();
  let target: Pick<Storage, "getItem" | "setItem"> | null = null;
  try {
    target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
  } catch {
    target = null;
  }
  const current = loadSidebarDensity(target);
  let next: SidebarDensity = "icons";
  if (current === "icons") {
    let stored: string | null = null;
    try { stored = target?.getItem(SIDEBAR_EXPANDED_DENSITY_KEY) ?? null; } catch { /* default below */ }
    const previous = parseSidebarDensity(stored);
    next = previous === "icons" ? "comfortable" : previous;
  } else {
    try { target?.setItem(SIDEBAR_EXPANDED_DENSITY_KEY, current); } catch { /* session only */ }
  }
  if (storage === undefined) setSidebarDensity(next);
  else saveSidebarDensity(next, target);
  return next;
}

/** The collapsed sidebar (icons density) is this wide. */
export const SIDEBAR_RAIL_WIDTH = 80;
/** Dragging the sidebar's edge narrower than this snaps it to the icons
 * rail; dragging the rail's edge past it expands the sidebar again. There is
 * no collapse button: the edge, its double-click and Settings > Appearance
 * are the ways in and out. */
export const SIDEBAR_SNAP_WIDTH = 180;

export type SidebarDragTarget = { collapsed: true } | { collapsed: false; width: number };

/** Where a drag of the sidebar's edge lands. `raw` is the width under the
 * pointer (the width the drag started from plus the pointer's travel, the
 * rail's 80px when it started collapsed). Below the snap width the sidebar
 * collapses; at or above it the width is clamped to the expanded range. */
export function sidebarDragTarget(
  raw: number,
  bounds: { min: number; max: number; snap?: number },
): SidebarDragTarget {
  const snap = bounds.snap ?? SIDEBAR_SNAP_WIDTH;
  if (!Number.isFinite(raw) || raw < snap) return { collapsed: true };
  return { collapsed: false, width: Math.round(Math.min(bounds.max, Math.max(bounds.min, raw))) };
}

// The sidebar and Settings → Appearance both read and change the density, so
// it lives in one renderer store rather than in either component's state.
// A session choice survives storage that rejects writes; another window's
// storage event supersedes it.
let densitySessionChoice: SidebarDensity | undefined;
const densityListeners = new Set<() => void>();

function currentSidebarDensity(): SidebarDensity {
  return densitySessionChoice ?? loadSidebarDensity();
}

function notifyDensity() {
  for (const listener of densityListeners) listener();
}

function onDensityStorage(event: StorageEvent) {
  if (event.key !== SIDEBAR_DENSITY_KEY && event.key !== null) return;
  try {
    if (event.storageArea && event.storageArea !== globalThis.localStorage) return;
  } catch {
    return;
  }
  densitySessionChoice = undefined;
  notifyDensity();
}

function subscribeDensity(listener: () => void): () => void {
  densityListeners.add(listener);
  if (densityListeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("storage", onDensityStorage);
  }
  return () => {
    densityListeners.delete(listener);
    if (densityListeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onDensityStorage);
    }
  };
}

/** The same store for callers that do not render through a hook. */
export function subscribeSidebarDensity(listener: () => void): () => void {
  return subscribeDensity(listener);
}

export function setSidebarDensity(density: SidebarDensity): void {
  densitySessionChoice = density;
  saveSidebarDensity(density);
  notifyDensity();
}

export function useSidebarDensity(): SidebarDensity {
  return useSyncExternalStore(subscribeDensity, currentSidebarDensity, () => "comfortable");
}

// The window's width decides how the sidebar is laid out (2026-11-01, Grok
// Bot's own behavior: its macOS window at 700 px collapses the sidebar to
// icons, at 1338 px it is full):
//   - below SIDEBAR_DRAWER_BELOW (Tailwind's `sm`, 640px: the app's phone
//     boundary, where sheets and page headers already switch) the sidebar is
//     a drawer that slides over the chat;
//   - from there up to SIDEBAR_AUTO_RAIL_BELOW (Tailwind's `md`, 768px, the
//     old drawer boundary) it is the icons rail, automatically;
//   - at and above `md` it follows the person's own density.
// The automatic rail is never saved: widening the window finds the person's
// choice where they left it.
export const SIDEBAR_DRAWER_BELOW = 640;
export const SIDEBAR_AUTO_RAIL_BELOW = 768;

/** phone: the drawer; medium: the automatic rail; wide: the person's density. */
export type SidebarViewport = "phone" | "medium" | "wide";

export function sidebarViewportFor(width: number): SidebarViewport {
  if (!Number.isFinite(width)) return "wide";
  if (width < SIDEBAR_DRAWER_BELOW) return "phone";
  if (width < SIDEBAR_AUTO_RAIL_BELOW) return "medium";
  return "wide";
}

/** The density the sidebar draws: the rail at medium widths, the person's
 * own density everywhere else (the phone drawer keeps it too). */
export function effectiveSidebarDensity(saved: SidebarDensity, viewport: SidebarViewport): SidebarDensity {
  return viewport === "medium" ? "icons" : saved;
}

const SIDEBAR_SM_QUERY = `(min-width: ${SIDEBAR_DRAWER_BELOW}px)`;
const SIDEBAR_MD_QUERY = `(min-width: ${SIDEBAR_AUTO_RAIL_BELOW}px)`;

function mediaMatches(query: string): boolean | null {
  try {
    const media = typeof window !== "undefined" ? window.matchMedia?.(query) : undefined;
    return media ? media.matches : null;
  } catch {
    return null;
  }
}

/** The sidebar layout for the window as it is now (same breakpoints as the
 * CSS: `max-sm:` drawer classes, `md` for the person's density). */
export function currentSidebarViewport(): SidebarViewport {
  const sm = mediaMatches(SIDEBAR_SM_QUERY);
  const md = mediaMatches(SIDEBAR_MD_QUERY);
  if (sm === null || md === null) return "wide";
  if (!sm) return "phone";
  return md ? "wide" : "medium";
}

function subscribeSidebarViewport(listener: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const lists: MediaQueryList[] = [];
  for (const query of [SIDEBAR_SM_QUERY, SIDEBAR_MD_QUERY]) {
    try {
      const list = window.matchMedia(query);
      if (list?.addEventListener) {
        list.addEventListener("change", listener);
        lists.push(list);
      }
    } catch {
      // no media queries: the sidebar stays wide
    }
  }
  return () => {
    for (const list of lists) list.removeEventListener("change", listener);
  };
}

/** Where the window's width puts the sidebar, following resizes. */
export function useSidebarViewport(): SidebarViewport {
  return useSyncExternalStore(subscribeSidebarViewport, currentSidebarViewport, () => "wide");
}

export function clampSidebarWidth(width: number, viewportWidth: number): number {
  return Math.max(240, Math.min(480, viewportWidth - 320, Math.round(width)));
}

export function loadSidebarWidth(storage?: Pick<Storage, "getItem"> | null): number | null {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    const raw = target?.getItem(SIDEBAR_WIDTH_KEY);
    if (raw === null || raw === undefined || !/^\d+$/.test(raw)) return null;
    const width = Number(raw);
    return width >= 240 && width <= 480 ? width : null;
  } catch {
    return null;
  }
}

export function saveSidebarWidth(width: number, storage?: Pick<Storage, "setItem"> | null): void {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    target?.setItem(SIDEBAR_WIDTH_KEY, String(width));
  } catch {
    // A blocked local store does not prevent resizing this session.
  }
}

export function parseSidebarAttentionPinned(value: string | null): boolean {
  return value === "true";
}

export function loadSidebarAttentionPinned(storage?: Pick<Storage, "getItem"> | null): boolean {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    return parseSidebarAttentionPinned(target?.getItem(SIDEBAR_ATTENTION_PINNED_KEY) ?? null);
  } catch {
    return false;
  }
}

export function saveSidebarAttentionPinned(
  pinned: boolean,
  storage?: Pick<Storage, "setItem"> | null,
): void {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    target?.setItem(SIDEBAR_ATTENTION_PINNED_KEY, String(pinned));
  } catch {
    // Private browsing and locked-down webviews may reject localStorage.
    // The in-memory React state still makes the control useful this session.
  }
}

export function parsePinnedCircles(value: string | null): boolean {
  return value === "true";
}

/** Session choice when storage rejects the write. Injected storage in tests
 * does not touch it, so a blocked localStorage cannot leak across cases. */
let sessionPinnedCircles: boolean | undefined;
const pinnedCircleListeners = new Set<() => void>();

function notifyPinnedCircles(): void {
  for (const listener of pinnedCircleListeners) listener();
}

function onPinnedCirclesStorage(event: StorageEvent): void {
  if (event.key !== PINNED_CIRCLES_KEY && event.key !== null) return;
  sessionPinnedCircles = undefined;
  notifyPinnedCircles();
}

export function subscribePinnedCircles(listener: () => void): () => void {
  pinnedCircleListeners.add(listener);
  if (
    pinnedCircleListeners.size === 1 &&
    typeof window !== "undefined" &&
    typeof window.addEventListener === "function"
  ) {
    window.addEventListener("storage", onPinnedCirclesStorage);
  }
  return () => {
    pinnedCircleListeners.delete(listener);
    if (
      pinnedCircleListeners.size === 0 &&
      typeof window !== "undefined" &&
      typeof window.removeEventListener === "function"
    ) {
      window.removeEventListener("storage", onPinnedCirclesStorage);
    }
  };
}

export function loadPinnedCircles(storage?: Pick<Storage, "getItem"> | null): boolean {
  if (storage === undefined && sessionPinnedCircles !== undefined) return sessionPinnedCircles;
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    return parsePinnedCircles(target?.getItem(PINNED_CIRCLES_KEY) ?? null);
  } catch {
    return false;
  }
}

export function savePinnedCircles(
  enabled: boolean,
  storage?: Pick<Storage, "setItem"> | null,
): void {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    target?.setItem(PINNED_CIRCLES_KEY, enabled ? "true" : "false");
  } catch {
    // Private browsing and locked-down webviews may reject localStorage.
    // The in-memory React state still makes the control useful this session.
  }
}

export function setPinnedCircles(enabled: boolean): void {
  sessionPinnedCircles = enabled;
  savePinnedCircles(enabled);
  notifyPinnedCircles();
}

export function usePinnedCircles(): boolean {
  return useSyncExternalStore(subscribePinnedCircles, loadPinnedCircles, () => false);
}

export function parseUniversalPins(value: string | null): boolean {
  return value === "true";
}

let sessionUniversalPins: boolean | undefined;
const universalPinListeners = new Set<() => void>();

function notifyUniversalPins(): void {
  for (const listener of universalPinListeners) listener();
}

function onUniversalPinsStorage(event: StorageEvent): void {
  if (event.key !== UNIVERSAL_PINS_KEY && event.key !== null) return;
  sessionUniversalPins = undefined;
  notifyUniversalPins();
}

export function subscribeUniversalPins(listener: () => void): () => void {
  universalPinListeners.add(listener);
  if (
    universalPinListeners.size === 1 &&
    typeof window !== "undefined" &&
    typeof window.addEventListener === "function"
  ) {
    window.addEventListener("storage", onUniversalPinsStorage);
  }
  return () => {
    universalPinListeners.delete(listener);
    if (
      universalPinListeners.size === 0 &&
      typeof window !== "undefined" &&
      typeof window.removeEventListener === "function"
    ) {
      window.removeEventListener("storage", onUniversalPinsStorage);
    }
  };
}

export function loadUniversalPins(storage?: Pick<Storage, "getItem"> | null): boolean {
  if (storage === undefined && sessionUniversalPins !== undefined) return sessionUniversalPins;
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    return parseUniversalPins(target?.getItem(UNIVERSAL_PINS_KEY) ?? null);
  } catch {
    return false;
  }
}

export function saveUniversalPins(
  enabled: boolean,
  storage?: Pick<Storage, "setItem"> | null,
): void {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    target?.setItem(UNIVERSAL_PINS_KEY, enabled ? "true" : "false");
  } catch {
    // Private browsing and locked-down webviews may reject localStorage.
  }
}

export function setUniversalPins(enabled: boolean): void {
  sessionUniversalPins = enabled;
  saveUniversalPins(enabled);
  notifyUniversalPins();
}

export function useUniversalPins(): boolean {
  return useSyncExternalStore(subscribeUniversalPins, loadUniversalPins, () => false);
}


const stringListSchema = z.array(z.string().min(1).max(240));

function parseStringList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = stringListSchema.safeParse(parsed);
    return result.success ? [...new Set(result.data)].slice(0, 100) : [];
  } catch {
    return [];
  }
}

function loadStringList(
  key: string,
  storage?: Pick<Storage, "getItem"> | null,
): string[] {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    return parseStringList(target?.getItem(key) ?? null);
  } catch {
    return [];
  }
}

function saveStringList(
  key: string,
  values: string[],
  storage?: Pick<Storage, "setItem"> | null,
): void {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    const safe = [
      ...new Set(values.filter((value) => value.length > 0 && value.length <= 240)),
    ].slice(0, 100);
    target?.setItem(key, JSON.stringify(safe));
  } catch {
    // Private browsing and locked-down webviews may reject localStorage.
    // In-memory React state still keeps the interaction useful this session.
  }
}

export function loadCollapsedSections(storage?: Pick<Storage, "getItem"> | null): string[] {
  return loadStringList(SIDEBAR_COLLAPSED_SECTIONS_KEY, storage);
}

export function saveCollapsedSections(
  ids: string[],
  storage?: Pick<Storage, "setItem"> | null,
): void {
  saveStringList(SIDEBAR_COLLAPSED_SECTIONS_KEY, ids, storage);
}

export function toggleCollapsedSection(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((candidate) => candidate !== id) : [...ids, id];
}

export function loadSectionOrder(storage?: Pick<Storage, "getItem"> | null): string[] {
  return loadStringList(SIDEBAR_SECTION_ORDER_KEY, storage);
}

export function saveSectionOrder(
  ids: string[],
  storage?: Pick<Storage, "setItem"> | null,
): void {
  saveStringList(SIDEBAR_SECTION_ORDER_KEY, ids, storage);
}
