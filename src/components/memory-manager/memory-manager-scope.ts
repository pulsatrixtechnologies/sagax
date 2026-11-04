import type { Place } from "./memory-manager-types";

type View = "notes" | "map" | "tags" | "quality";

const SCOPE_KEY = "sagax.memory.scope";
export function memoryScopeKey(principalId: string | null | undefined): string {
  const id = principalId?.trim();
  return id ? `${SCOPE_KEY}:${id}` : SCOPE_KEY;
}
const VIEWS: readonly View[] = ["notes", "map", "tags", "quality"];
const LIST_PLACES = ["all", "teams", "pinned", "recent", "review", "archived", "trash", "collections"];

export function readMemoryScope(key: string): { view: View; place: Place } {
  const fallback = { view: "notes" as View, place: { kind: "all" } as Place };
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "null") as { view?: unknown; place?: { kind?: unknown; tier?: unknown; folder?: unknown } } | null;
    if (!value || typeof value !== "object") return fallback;
    const view = VIEWS.includes(value.view as View) ? value.view as View : "notes";
    const raw = value.place;
    let place: Place = { kind: "all" };
    if (raw && typeof raw.kind === "string") {
      if (LIST_PLACES.includes(raw.kind)) place = { kind: raw.kind as "all" };
      else if (raw.kind === "tier" && typeof raw.tier === "string") place = { kind: "tier", tier: raw.tier };
      else if (raw.kind === "folder" && typeof raw.tier === "string" && typeof raw.folder === "string") place = { kind: "folder", tier: raw.tier, folder: raw.folder };
    }
    return { view, place };
  } catch {
    return fallback;
  }
}

export function writeMemoryScope(key: string, view: View, place: Place) {
  try { window.localStorage.setItem(key, JSON.stringify({ view, place })); } catch { /* a private window: the scope lasts for this page */ }
}

export type MemoryView = View;
