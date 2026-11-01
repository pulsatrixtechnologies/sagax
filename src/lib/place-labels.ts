// Client store for Computer place labels (shared/place-labels.ts). Synced
// through user preferences (USER_PREFERENCE_KEYS + user-preferences-sync)
// so a person's names follow them. Isolation: each person's map is their own.
import { useSyncExternalStore } from "react";

import {
  PLACE_LABELS_PREFERENCE,
  parsePlaceLabels,
  placeDisplayName,
  serializePlaceLabels,
  setPlaceLabel,
  type PlaceKey,
  type PlaceLabels,
} from "../../shared/place-labels";

let labels: PlaceLabels = {};
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function store(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

function readStorage(): PlaceLabels {
  try {
    return parsePlaceLabels(store()?.getItem(PLACE_LABELS_PREFERENCE));
  } catch {
    return {};
  }
}

labels = readStorage();

function write(next: PlaceLabels) {
  labels = next;
  try {
    const serialized = serializePlaceLabels(next);
    if (Object.keys(next).length) store()?.setItem(PLACE_LABELS_PREFERENCE, serialized);
    else store()?.removeItem(PLACE_LABELS_PREFERENCE);
  } catch { /* quota */ }
  emit();
}

export function subscribePlaceLabels(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

function onStorage(event: StorageEvent) {
  if (event.key !== PLACE_LABELS_PREFERENCE && event.key !== null) return;
  labels = readStorage();
  emit();
}

export function getPlaceLabels(): PlaceLabels {
  return labels;
}

export function placeLabel(key: PlaceKey, technical: string): string {
  return placeDisplayName(key, technical, labels);
}

export function usePlaceLabels(): PlaceLabels {
  return useSyncExternalStore(subscribePlaceLabels, getPlaceLabels, getPlaceLabels);
}

export function usePlaceLabel(key: PlaceKey, technical: string): string {
  const map = usePlaceLabels();
  return placeDisplayName(key, technical, map);
}

/** Save a label for this place (null or blank clears). */
export function savePlaceLabel(key: PlaceKey, label: string | null): void {
  write(setPlaceLabel(labels, key, label));
}

export function reloadPlaceLabels(): void {
  labels = readStorage();
  emit();
}

export function resetPlaceLabelsForTests(next: PlaceLabels = {}): void {
  write(next);
}
