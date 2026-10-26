// The small status dot of each screen in the Computer tab's picker (and on
// its closed button): yellow while a computer sleeps or wakes (the cloud
// cluster stopped while idle, a paused Local VM), green when it is
// up and reachable, a neutral light grey when it is off, not started, or
// failed (never red: the dot stays quiet).
//
// Each screen reports what it already knows when it reads its own status
// (ServerComputerScreen, LocalComputerScreen, the browser preview); the
// picker shows the last known state of the others, without polling them.
import { useSyncExternalStore } from "react";

import type { ScreenState } from "./desktop-local-vm";

export type ScreenDot = "asleep" | "online" | "offline";

/** A computer's screen state to its dot. `waking`: the cloud cluster is
 * being woken (it slept while idle). */
export function screenDot(state: ScreenState | null | undefined, waking = false): ScreenDot {
  if (waking) return "asleep";
  if (state === "running") return "online";
  if (state === "paused" || state === "starting") return "asleep";
  return "offline";
}

/** The bot's browser: green while a browser session is live (shown, or the
 * bot busy in it), neutral otherwise. */
export function browserDot(session: boolean): ScreenDot {
  return session ? "online" : "offline";
}

/** Theme tokens only, so the dot reads the same in every skin. */
export const SCREEN_DOT_CLASS: Record<ScreenDot, string> = {
  asleep: "bg-warning",
  online: "bg-success",
  offline: "bg-ink-tertiary/50",
};

export const SCREEN_DOT_LABEL_KEY = {
  asleep: "orgComputer.dot.asleep",
  online: "orgComputer.dot.online",
  offline: "orgComputer.dot.offline",
} as const satisfies Record<ScreenDot, string>;

/** Screen keys: "server", "desktop:<desktop id>", "browser:<bot id>". */
let dots: Readonly<Record<string, ScreenDot>> = {};
const listeners = new Set<() => void>();

export function reportScreenDot(key: string, dot: ScreenDot): void {
  if (dots[key] === dot) return;
  dots = { ...dots, [key]: dot };
  for (const listener of listeners) listener();
}

export function screenDots(): Readonly<Record<string, ScreenDot>> {
  return dots;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useScreenDots(): Readonly<Record<string, ScreenDot>> {
  return useSyncExternalStore(subscribe, screenDots, screenDots);
}

/** Tests only. */
export function resetScreenDots(): void {
  dots = {};
  for (const listener of listeners) listener();
}
