// Per-person labels for Computer places (2026-11-01): Cloud, each desktop,
// Browser, enrolled hosts. A person renames their own places; an org-shared
// host's label is set by its owner. The technical name stays for tooltip/Copy.
// Stored as one JSON string under PLACE_LABELS_PREFERENCE (user preferences).

export const PLACE_LABELS_PREFERENCE = "sagax.placeLabels.v1";

export const PLACE_LABEL_MAX = 80;

/** A place key as used by the Computer picker (`server`, `desktop:<id>`,
 * `browser`, `host:<hostId>`). */
export type PlaceKey = string;

export type PlaceLabels = Record<PlaceKey, string>;

export function normalizePlaceLabel(value: unknown):
  | { ok: true; label: string | null }
  | { ok: false; code: "label_type" | "label_one_line" | "label_too_long" } {
  if (value === null || value === undefined) return { ok: true, label: null };
  if (typeof value !== "string") return { ok: false, code: "label_type" };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return { ok: false, code: "label_one_line" };
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return { ok: true, label: null };
  if (trimmed.length > PLACE_LABEL_MAX) return { ok: false, code: "label_too_long" };
  return { ok: true, label: trimmed };
}

export function parsePlaceLabels(value: string | null | undefined): PlaceLabels {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: PlaceLabels = {};
    for (const [key, label] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof key !== "string" || !key || key.length > 120) continue;
      const normalized = normalizePlaceLabel(label);
      if (normalized.ok && normalized.label) out[key] = normalized.label;
    }
    return out;
  } catch {
    return {};
  }
}

export function serializePlaceLabels(labels: PlaceLabels): string {
  const clean: PlaceLabels = {};
  for (const [key, label] of Object.entries(labels)) {
    const normalized = normalizePlaceLabel(label);
    if (normalized.ok && normalized.label) clean[key] = normalized.label;
  }
  return JSON.stringify(clean);
}

/** The name shown for a place: the person's label when set, else the technical name. */
export function placeDisplayName(key: PlaceKey, technical: string, labels: PlaceLabels): string {
  return labels[key]?.trim() || technical;
}

/** Set or clear one label; returns the next map. */
export function setPlaceLabel(labels: PlaceLabels, key: PlaceKey, label: string | null): PlaceLabels {
  const next = { ...labels };
  const normalized = normalizePlaceLabel(label);
  if (!normalized.ok || !normalized.label) {
    delete next[key];
    return next;
  }
  next[key] = normalized.label;
  return next;
}
