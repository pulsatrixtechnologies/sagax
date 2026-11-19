// The screen side panel (#4452): the bot's browser (later its VM and remote
// computer) in a resizable column beside the main chat, opened and closed with
// Cmd+Shift+B (Ctrl+Shift+B elsewhere). Open or closed is this window's own
// (a module store like side-thread.ts, never the app store or the server);
// only its width is remembered (DockedPanelResize, its own key).
import { useSyncExternalStore } from "react";

export const SCREEN_PANEL_WIDTH_KEY = "sagax.screenPanel.width.v1";
export const SCREEN_PANEL_MIN_WIDTH = 360;
export const SCREEN_PANEL_MAX_WIDTH = 960;
export const SCREEN_PANEL_DEFAULT_WIDTH = 480;

/** The places a bot works in, one tab each (lot d adds "vm" and "remote"). */
export type ScreenPlace = "browser";

let open = false;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function isScreenPanelOpen(): boolean {
  return open;
}

export function setScreenPanelOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  notify();
}

export function toggleScreenPanel(): void {
  setScreenPanelOpen(!open);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useScreenPanelOpen(): boolean {
  return useSyncExternalStore(subscribe, isScreenPanelOpen, isScreenPanelOpen);
}
