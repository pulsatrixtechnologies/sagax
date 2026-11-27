// Browser (and later artifact) takeover window opened from the screen side
// panel's Detach / Expand actions. Lives outside ScreenPanel so Detach can
// close the docked column without unmounting the window.
import { useSyncExternalStore } from "react";

export type ScreenPanelWindow = {
  botId: string;
  /** "expand" keeps the side panel; "detach" closes it. */
  mode: "expand" | "detach";
  kind: "browser" | "artifact";
  artifactId?: string;
};

let current: ScreenPanelWindow | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function getScreenPanelWindow(): ScreenPanelWindow | null {
  return current;
}

export function openScreenPanelWindow(next: ScreenPanelWindow): void {
  current = next;
  notify();
}

export function closeScreenPanelWindow(): void {
  if (!current) return;
  current = null;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useScreenPanelWindow(): ScreenPanelWindow | null {
  return useSyncExternalStore(subscribe, getScreenPanelWindow, getScreenPanelWindow);
}
