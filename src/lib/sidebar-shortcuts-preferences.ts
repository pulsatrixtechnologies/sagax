import { useSyncExternalStore } from "react";

import { browseBotsEnabled, type FeatureFlagConfig } from "@/lib/feature-flags";

export const SIDEBAR_SHORTCUTS_KEY = "sagax-sidebar-shortcuts";

// Settings > Appearance > Sidebar shortcuts: the two menu rows at the foot of
// the sidebar (Connected apps, Browse Bots). Only a renderer preference,
// stored per person on this device ("1" on, "0" off). While it is on, the
// account row below drops the title and points line, for lack of room.
//
// Before this setting the Browse Bots row followed an installation switch in
// Settings > Experimental features (Browse Bots under `features.templates`). A
// person with no stored choice keeps what they saw: on when that switch was on
// (`legacySidebarShortcuts`), and `migrateSidebarShortcuts` writes that value
// once, so it stays theirs.
let sessionChoice: boolean | undefined;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** The person's own choice, or undefined when they never made one. */
export function storedSidebarShortcuts(): boolean | undefined {
  if (sessionChoice !== undefined) return sessionChoice;
  try {
    const value = storage()?.getItem(SIDEBAR_SHORTCUTS_KEY);
    return value === "1" ? true : value === "0" ? false : undefined;
  } catch {
    return undefined;
  }
}

/** What the sidebar showed before the setting: the rows were there when the
 * Browse Bots experimental switch was on. */
export function legacySidebarShortcuts(config: FeatureFlagConfig | null | undefined): boolean {
  return browseBotsEnabled(config);
}

/** The setting's value: the stored choice, else the legacy one. */
export function sidebarShortcutsOn(config: FeatureFlagConfig | null | undefined): boolean {
  return storedSidebarShortcuts() ?? legacySidebarShortcuts(config);
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== SIDEBAR_SHORTCUTS_KEY && event.key !== null) return;
  if (event.storageArea && event.storageArea !== storage()) return;
  sessionChoice = undefined;
  notify();
}

function subscribe(listener: () => void): () => void {
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

export function setSidebarShortcuts(enabled: boolean): void {
  sessionChoice = enabled;
  try {
    storage()?.setItem(SIDEBAR_SHORTCUTS_KEY, enabled ? "1" : "0");
  } catch {
    // The visible setting still changes for this session when storage is full.
  }
  notify();
}

/** Writes the legacy value once, for a person with no stored choice, as soon
 * as the configuration is known. Returns whether it wrote. */
export function migrateSidebarShortcuts(config: FeatureFlagConfig | null | undefined): boolean {
  if (!config || storedSidebarShortcuts() !== undefined) return false;
  setSidebarShortcuts(legacySidebarShortcuts(config));
  return true;
}

/** Test seam: forget the session choice. */
export function resetSidebarShortcutsForTests(): void {
  sessionChoice = undefined;
}

export function useSidebarShortcuts(config: FeatureFlagConfig | null | undefined): boolean {
  const stored = useSyncExternalStore(
    subscribe,
    () => storedSidebarShortcuts() ?? null,
    () => null,
  );
  return stored ?? legacySidebarShortcuts(config);
}
