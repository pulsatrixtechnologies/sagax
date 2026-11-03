import { useSyncExternalStore } from "react";

// Simple or Advanced, one choice per person. Advanced is the default for
// everyone: a new install, a solo server, an organization owner, admin or
// member (2026-10-16). An explicit choice (this key) always wins.
// Nothing is deleted when the switch is off: a hidden setting keeps its value.
// The choice is written only when the person toggles it. On an organization
// server the key is one of USER_PREFERENCE_KEYS and follows the person; solo
// keeps it in localStorage.
export const INTERFACE_MODE_KEY = "sagax.interfaceMode.v1";

// The one-time move to Advanced (2026-10-16): a person who had Simple stored
// is set to Advanced once, then this marker (an ISO date) is written and the
// move never runs again, so Simple chosen afterwards stays. It is one of
// USER_PREFERENCE_KEYS: on an organization server the server runs the same
// move on its records (server/people/user-preferences.ts) and the marker follows the
// person, so no device moves them a second time.
export const ADVANCED_MODE_MIGRATION_KEY = "sagax.advancedModeMigratedAt.v1";

// The previous key was written on every boot (settle always stored "1").
// It is not a choice. Dropped at startup.
export const LEGACY_ADVANCED_MODE_KEY = "omb-advanced-mode";

export type InterfaceMode = "simple" | "advanced";

export const DEFAULT_INTERFACE_MODE: InterfaceMode = "advanced";

// Keep a session choice even if private/blocked storage rejects reads or
// writes; another window's storage event can supersede that choice.
let sessionChoice: InterfaceMode | undefined;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** The stored choice, null when there is none, undefined when storage
 * cannot be read (both fall back to the default). */
function readStored(): InterfaceMode | null | undefined {
  try {
    const store = storage();
    if (!store) return null;
    const stored = store.getItem(INTERFACE_MODE_KEY);
    if (stored === "simple" || stored === "advanced") return stored;
    return null;
  } catch {
    return undefined;
  }
}

export function readInterfaceMode(): InterfaceMode {
  if (sessionChoice !== undefined) return sessionChoice;
  return readStored() || DEFAULT_INTERFACE_MODE;
}

export function readAdvancedMode(): boolean {
  return readInterfaceMode() === "advanced";
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== INTERFACE_MODE_KEY && event.key !== null) return;
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

export function setInterfaceMode(mode: InterfaceMode): void {
  sessionChoice = mode;
  try {
    storage()?.setItem(INTERFACE_MODE_KEY, mode);
  } catch {
    // The switch still takes effect for this session when storage is full.
  }
  notify();
}

export function setAdvancedMode(enabled: boolean): void {
  setInterfaceMode(enabled ? "advanced" : "simple");
}

/** Remove the old always-on key. It is not read. */
export function retireLegacyInterfaceMode(): void {
  try {
    storage()?.removeItem(LEGACY_ADVANCED_MODE_KEY);
  } catch {
    // Nothing to retire when storage is blocked.
  }
}

type MigrationStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * The one-time move to Advanced. Runs at startup, after an organization
 * server's record was applied (src/main.tsx). Without the marker: a stored
 * Simple becomes Advanced and the marker is written. With the marker:
 * nothing, whatever the person chose since. Returns true when it moved the
 * person. Storage that cannot be read or written leaves everything as is
 * (the next start tries again).
 */
export function migrateInterfaceModeToAdvancedOnce(store: MigrationStorage | undefined = storage(), now: () => Date = () => new Date()): boolean {
  if (!store) return false;
  try {
    if (store.getItem(ADVANCED_MODE_MIGRATION_KEY)) return false;
    const moved = store.getItem(INTERFACE_MODE_KEY) === "simple";
    if (moved) store.setItem(INTERFACE_MODE_KEY, "advanced");
    store.setItem(ADVANCED_MODE_MIGRATION_KEY, now().toISOString());
    if (moved && store === storage()) {
      sessionChoice = undefined;
      notify();
    }
    return moved;
  } catch {
    return false;
  }
}

export function useAdvancedMode(): boolean {
  // The server snapshot is the same read as the client. A static render
  // (and a test) must see the stored choice, not a hardcoded Advanced.
  return useSyncExternalStore(subscribe, readAdvancedMode, readAdvancedMode);
}
