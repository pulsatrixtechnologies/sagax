// Unified synced preference sagax.uiLayout.v1 (D-20261127-004, #5443).
// Absorbs sagax.composerBarLayout.v1 and sagax.usagePillPlacement.v1 on first
// read; mirrors them on every save so Appearance rows and old readers keep working.
import { useSyncExternalStore } from "react";

import { fillMissingAtDefault } from "./ordered-of";
import { defaultZoneOrder } from "./registry";
import type { UiLayoutV1, UsagePlacement, ZoneId, ZoneLayout } from "./types";
import {
  COMPOSER_BAR_COMPONENT_IDS,
  UI_LAYOUT_KEY,
  USAGE_PLACEMENTS,
  ZONE_IDS,
} from "./types";

export const COMPOSER_BAR_LAYOUT_LEGACY_KEY = "sagax.composerBarLayout.v1";
export const USAGE_PILL_PLACEMENT_LEGACY_KEY = "sagax.usagePillPlacement.v1";

export function defaultUiLayout(): UiLayoutV1 {
  return {
    version: 1,
    zones: {
      composerBar: {
        order: defaultZoneOrder("composerBar"),
        hidden: [],
        left: 1,
        usagePlacement: "inBar",
      },
      sidebar: {
        order: defaultZoneOrder("sidebar"),
        hidden: [],
      },
      conversationHeader: {
        order: defaultZoneOrder("conversationHeader"),
        hidden: [],
      },
      botPage: {
        order: defaultZoneOrder("botPage"),
        hidden: [],
      },
    },
  };
}

function isUsagePlacement(value: unknown): value is UsagePlacement {
  return typeof value === "string" && (USAGE_PLACEMENTS as readonly string[]).includes(value);
}

function normalizeComposerOrder(raw: unknown): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry !== "string") continue;
      if (!(COMPOSER_BAR_COMPONENT_IDS as readonly string[]).includes(entry)) continue;
      if (seen.has(entry)) continue;
      seen.add(entry);
      order.push(entry);
    }
  }
  for (const id of COMPOSER_BAR_COMPONENT_IDS) {
    if (!seen.has(id)) order.push(id);
  }
  return order;
}

function normalizeStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || !entry || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}

function normalizeZone(zoneId: ZoneId, raw: unknown, fallback: ZoneLayout): ZoneLayout {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...fallback, order: [...fallback.order], hidden: [...fallback.hidden] };
  const record = raw as { order?: unknown; hidden?: unknown; left?: unknown; usagePlacement?: unknown };
  let order = normalizeStringList(record.order);
  let hidden = normalizeStringList(record.hidden);
  if (zoneId === "composerBar") {
    // Hidden composer items stay out of order; fill missing visibles at default place.
    const hiddenSet = new Set(hidden.filter((id) => (COMPOSER_BAR_COMPONENT_IDS as readonly string[]).includes(id)));
    hidden = [...hiddenSet];
    const seen = new Set<string>();
    const fromRaw: string[] = [];
    if (Array.isArray(record.order)) {
      for (const entry of record.order) {
        if (typeof entry !== "string") continue;
        if (!(COMPOSER_BAR_COMPONENT_IDS as readonly string[]).includes(entry)) continue;
        if (hiddenSet.has(entry) || seen.has(entry)) continue;
        seen.add(entry);
        fromRaw.push(entry);
      }
    }
    order = fillMissingAtDefault(fromRaw, hidden, COMPOSER_BAR_COMPONENT_IDS);
    const leftRaw = typeof record.left === "number" && Number.isFinite(record.left)
      ? Math.trunc(record.left)
      : (fallback.left ?? 1);
    const left = Math.max(0, Math.min(order.length, leftRaw));
    const usagePlacement = isUsagePlacement(record.usagePlacement)
      ? record.usagePlacement
      : (fallback.usagePlacement ?? "inBar");
    return { order, hidden, left, usagePlacement };
  }
  if (order.length === 0 && hidden.length === 0) {
    order = [...fallback.order];
  }
  // Drop ids that appear in both lists (hidden wins); fill missing known defaults at default place.
  const hiddenSet = new Set(hidden);
  order = fillMissingAtDefault(
    order.filter((id) => !hiddenSet.has(id)),
    hidden,
    fallback.order,
  );
  return { order, hidden };
}

/** Parse stored JSON. Missing or broken values become the default. */
export function parseUiLayout(raw: string | null | undefined): UiLayoutV1 {
  const fallback = defaultUiLayout();
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
    const record = parsed as { version?: unknown; zones?: unknown };
    if (record.version !== 1 || !record.zones || typeof record.zones !== "object" || Array.isArray(record.zones)) {
      return fallback;
    }
    const zonesRaw = record.zones as Record<string, unknown>;
    const zones = {} as UiLayoutV1["zones"];
    for (const zoneId of ZONE_IDS) {
      zones[zoneId] = normalizeZone(zoneId, zonesRaw[zoneId], fallback.zones[zoneId]);
    }
    return { version: 1, zones };
  } catch {
    return fallback;
  }
}

export function serializeUiLayout(layout: UiLayoutV1): string {
  const normalized = parseUiLayout(JSON.stringify(layout));
  return JSON.stringify(normalized);
}

function storage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

function readLegacyComposer(): { order: string[]; left: number } | null {
  let raw: string | null = null;
  try { raw = storage()?.getItem(COMPOSER_BAR_LAYOUT_LEGACY_KEY) ?? null; } catch { raw = null; }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as { order?: unknown; left?: unknown };
    const order = normalizeComposerOrder(record.order);
    const leftRaw = typeof record.left === "number" && Number.isFinite(record.left) ? Math.trunc(record.left) : 1;
    return { order, left: Math.max(0, Math.min(order.length, leftRaw)) };
  } catch {
    return null;
  }
}

function readLegacyUsagePlacement(): UsagePlacement | null {
  let raw: string | null = null;
  try { raw = storage()?.getItem(USAGE_PILL_PLACEMENT_LEGACY_KEY) ?? null; } catch { raw = null; }
  return isUsagePlacement(raw) ? raw : null;
}

/** Build uiLayout from legacy keys when uiLayout is missing. */
export function migrateFromLegacy(): UiLayoutV1 {
  const base = defaultUiLayout();
  const composer = readLegacyComposer();
  const placement = readLegacyUsagePlacement();
  if (composer) {
    base.zones.composerBar.order = composer.order;
    base.zones.composerBar.left = composer.left;
  }
  if (placement) {
    base.zones.composerBar.usagePlacement = placement;
  }
  return base;
}

function mirrorLegacy(layout: UiLayoutV1): void {
  const zone = layout.zones.composerBar;
  const order = normalizeComposerOrder(zone.order.concat(zone.hidden.filter((id) =>
    (COMPOSER_BAR_COMPONENT_IDS as readonly string[]).includes(id))));
  // Legacy order stores every item (including ones hidden in uiLayout) so old
  // readers still see a full list; hide is a uiLayout-only concern.
  const fullOrder = normalizeComposerOrder([...zone.order, ...zone.hidden]);
  const left = Math.max(0, Math.min(fullOrder.length, zone.left ?? 1));
  const composerRaw = JSON.stringify({ order: fullOrder.length ? fullOrder : order, left });
  const placement = zone.usagePlacement ?? "inBar";
  try {
    const local = storage();
    local?.setItem(COMPOSER_BAR_LAYOUT_LEGACY_KEY, composerRaw);
    local?.setItem(USAGE_PILL_PLACEMENT_LEGACY_KEY, placement);
  } catch {
    // session still holds the visible choice through uiLayout
  }
}

// ── store ───────────────────────────────────────────────────────────────

let session: UiLayoutV1 | null = null;
let cachedRaw: string | null | undefined;
let cachedValue: UiLayoutV1 = defaultUiLayout();
let migratedThisSession = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function ensureMigrated(raw: string | null): UiLayoutV1 {
  if (raw) return parseUiLayout(raw);
  if (migratedThisSession && session) return session;
  const migrated = migrateFromLegacy();
  migratedThisSession = true;
  // Persist uiLayout and keep legacy mirrors aligned.
  const serialized = serializeUiLayout(migrated);
  try {
    storage()?.setItem(UI_LAYOUT_KEY, serialized);
  } catch { /* session holds it */ }
  mirrorLegacy(migrated);
  cachedRaw = serialized;
  cachedValue = migrated;
  return migrated;
}

function read(): UiLayoutV1 {
  if (session) return session;
  let raw: string | null = null;
  try { raw = storage()?.getItem(UI_LAYOUT_KEY) ?? null; } catch { raw = null; }
  if (raw === cachedRaw && cachedRaw !== undefined) return cachedValue;
  if (!raw) {
    const migrated = ensureMigrated(null);
    return migrated;
  }
  cachedRaw = raw;
  cachedValue = parseUiLayout(raw);
  return cachedValue;
}

function onStorage(event: StorageEvent): void {
  if (
    event.key !== UI_LAYOUT_KEY
    && event.key !== COMPOSER_BAR_LAYOUT_LEGACY_KEY
    && event.key !== USAGE_PILL_PLACEMENT_LEGACY_KEY
    && event.key !== null
  ) return;
  if (event.storageArea && event.storageArea !== storage()) return;
  session = null;
  cachedRaw = undefined;
  migratedThisSession = false;
  emit();
}

export function getUiLayout(): UiLayoutV1 {
  return read();
}

export function setUiLayout(next: UiLayoutV1): void {
  const normalized = parseUiLayout(serializeUiLayout(next));
  session = normalized;
  const raw = serializeUiLayout(normalized);
  try {
    const local = storage();
    local?.setItem(UI_LAYOUT_KEY, raw);
    if (local?.getItem(UI_LAYOUT_KEY) === raw) session = null;
  } catch {
    // session still holds the visible choice
  }
  mirrorLegacy(normalized);
  cachedRaw = raw;
  cachedValue = normalized;
  emit();
}

export function resetUiLayoutToDefaults(): UiLayoutV1 {
  const next = defaultUiLayout();
  setUiLayout(next);
  return next;
}

export function subscribeUiLayout(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function useUiLayout(): UiLayoutV1 {
  return useSyncExternalStore(subscribeUiLayout, getUiLayout, defaultUiLayout);
}

/** Test helper: drop session and storage so the next read migrates fresh. */
export function resetUiLayoutStoreForTests(): void {
  session = null;
  cachedRaw = undefined;
  cachedValue = defaultUiLayout();
  migratedThisSession = false;
  try {
    const local = storage();
    local?.removeItem(UI_LAYOUT_KEY);
    local?.removeItem(COMPOSER_BAR_LAYOUT_LEGACY_KEY);
    local?.removeItem(USAGE_PILL_PLACEMENT_LEGACY_KEY);
  } catch { /* */ }
  emit();
}

/** Facades: composer order/left from the unified store. */
export function composerLayoutFromUi(layout: UiLayoutV1): { order: string[]; left: number } {
  const zone = layout.zones.composerBar;
  const hidden = new Set(zone.hidden);
  // Facade order includes hidden items after visibles so legacy move helpers keep working.
  const order = normalizeComposerOrder([...zone.order, ...zone.hidden.filter((id) => !zone.order.includes(id))]);
  // Prefer the visible-only left count when nothing is hidden; otherwise clamp.
  const visibleLeft = zone.left ?? 1;
  void hidden;
  return { order, left: Math.max(0, Math.min(order.length, visibleLeft)) };
}

export function usagePlacementFromUi(layout: UiLayoutV1): UsagePlacement {
  return layout.zones.composerBar.usagePlacement ?? "inBar";
}
