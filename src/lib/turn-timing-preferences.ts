// 2026-10-28: a developer setting. A conversation's two counters (wait
// before send, first answer text, server/turns/turn-trace.ts) are diagnostics,
// never part of the conversation: off unless this device turns them on in
// Settings > Appearance (Advanced mode).
import { useSyncExternalStore } from "react";

export const TURN_TIMING_KEY = "sagax-show-turn-timing";

// Only a renderer preference: no conversation or server configuration belongs
// here. Keep a session choice even if private/blocked storage rejects reads or
// writes; another window's storage event can supersede that choice.
let sessionChoice: boolean | undefined;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function showTurnTiming(): boolean {
  if (sessionChoice !== undefined) return sessionChoice;
  try {
    return storage()?.getItem(TURN_TIMING_KEY) === "1";
  } catch {
    return false;
  }
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== TURN_TIMING_KEY && event.key !== null) return;
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

export function setShowTurnTiming(enabled: boolean): void {
  sessionChoice = enabled;
  try {
    storage()?.setItem(TURN_TIMING_KEY, enabled ? "1" : "0");
  } catch {
    // The visible setting still changes for this session when storage is full.
  }
  notify();
}

export function useShowTurnTiming(): boolean {
  // a static render (and a test) reads the stored choice too
  return useSyncExternalStore(subscribe, showTurnTiming, showTurnTiming);
}
