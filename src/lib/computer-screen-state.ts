// What the bot panel's Computer card and its live window say about the
// screen ("the thumbnail should adapt to the state"; opening
// his Mac showed "The screen is temporarily unavailable."). Three looks for
// the thumbnail: the real picture, asleep (the computer is off or offline),
// and unavailable (awake, but no picture, with the reason). The row's
// Awake / Asleep line follows the same state, and every missing picture has
// its real reason, never a generic one.
import { useEffect, useState } from "react";

import { api } from "@/state/store/api";
import { isReadyBoatState } from "@/lib/local-computer";
import type { LocaleKey } from "@/locales";

/** Why there is no picture of a screen. */
export type ScreenProblem =
  /** macOS has not allowed Sagax to record the screen. */
  | "permission"
  /** The capture came back empty although it is allowed (just granted: relaunch). */
  | "empty"
  /** The capture itself failed (its error is shown with it). */
  | "capture-failed"
  /** A web browser cannot see this computer's screen: the desktop app can. */
  | "desktop-app-only"
  /** No capture of this computer yet (the bot has not looked at it). */
  | "no-capture"
  /** The bot has no computer with a screen (Browser only). */
  | "no-computer";

export type ComputerThumbLook = "screen" | "asleep" | "unavailable";
export type ComputerCardStatus = "working" | "awake" | "asleep";

export interface ComputerCardView {
  thumb: ComputerThumbLook;
  status: ComputerCardStatus;
  problem: ScreenProblem | null;
}

/** Why this computer's own screen shows no picture, from what the desktop
 * app says. `screenPermission`: perm:status "screen" (granted, denied,
 * not-determined, unknown; undefined on an older app). */
export function localScreenProblem({ inApp, mac, screenPermission, failed = false, failure }: {
  inApp: boolean;
  mac: boolean;
  screenPermission?: string | undefined;
  failed?: boolean;
  /** The capture's own error, when it failed. */
  failure?: string | null;
}): ScreenProblem {
  if (!inApp) return "desktop-app-only";
  // on a Mac, Electron's "Failed to get sources" is macOS
  // refusing Screen Recording. Say how to allow it, not the raw IPC error.
  if (mac && (screenPermission !== "granted" || MAC_SCREEN_REFUSED.test(failure ?? ""))) return "permission";
  if (failed) return "capture-failed";
  return "empty";
}

const MAC_SCREEN_REFUSED = /Failed to get sources/i;

/** The card's look for the computer the bot works on now.
 * `source`: "local" (the person's computer), "cloud" (the bot's own cloud
 * computer), "other" (Local VM, a server computer), "none" (Off, Browser).
 * `online`: false when the person's computer is asleep or offline.
 * `cloudAsleep`: the cloud computer is stopped or not created yet. */
export function computerCardView({ busy, off = false, source, online = true, cloudAsleep = false, hasCapture, localProblem = null }: {
  busy: boolean;
  off?: boolean;
  source: "local" | "cloud" | "other" | "none";
  online?: boolean;
  cloudAsleep?: boolean;
  hasCapture: boolean;
  /** Why the person's own computer has no picture (localScreenProblem). */
  localProblem?: ScreenProblem | null;
}): ComputerCardView {
  const awake: ComputerCardStatus = busy ? "working" : "awake";
  if (off) return { thumb: "asleep", status: "asleep", problem: null };
  if (source === "none") return { thumb: "unavailable", status: awake, problem: "no-computer" };
  if ((source === "local" && !online) || (source === "cloud" && cloudAsleep && !busy)) {
    return { thumb: "asleep", status: "asleep", problem: null };
  }
  if (hasCapture) return { thumb: "screen", status: awake, problem: null };
  const problem = source === "local" && localProblem && localProblem !== "empty" ? localProblem : "no-capture";
  return { thumb: "unavailable", status: awake, problem };
}

/** Short words for the row's second line next to Awake / Working. */
export const SCREEN_PROBLEM_SHORT: Record<ScreenProblem, LocaleKey> = {
  "permission": "computerThumb.short.permission",
  "empty": "computerThumb.short.empty",
  "capture-failed": "computerThumb.short.failed",
  "desktop-app-only": "computerThumb.short.desktopApp",
  "no-capture": "computerThumb.short.noCapture",
  "no-computer": "computerThumb.short.noComputer",
};

/** The full reason, for the thumbnail's tooltip and the live window. */
export const SCREEN_PROBLEM_LINE: Record<ScreenProblem, LocaleKey> = {
  "permission": "computerThumb.line.permission",
  "empty": "computerThumb.line.empty",
  "capture-failed": "computerThumb.line.failed",
  "desktop-app-only": "computerThumb.line.desktopApp",
  "no-capture": "computerThumb.line.noCapture",
  "no-computer": "computerThumb.line.noComputer",
};

/** Screen Recording as the desktop app reads it (no prompt) and this
 * computer's host name, refreshed when the window comes back to the front
 * (after a visit to System Settings). Empty outside the app or on an older app. */
export function useScreenPermission(): { screen?: string; host?: string } {
  const [status, setStatus] = useState<{ screen?: string; host?: string }>({});
  useEffect(() => {
    const read = typeof window === "undefined" ? undefined : window.ogb?.permStatus;
    if (typeof read !== "function") return;
    let alive = true;
    const refresh = () => {
      read().then((answer) => {
        if (!alive) return;
        const screen = typeof answer?.screen === "string" ? answer.screen : undefined;
        const host = typeof answer?.host === "string" ? answer.host : undefined;
        setStatus((previous) => previous.screen === screen && previous.host === host ? previous : { screen, host });
      }).catch(() => { /* an older app: no status */ });
    };
    refresh();
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  return status;
}

const SLEEPING_BOAT = new Set(["archived", "stopped", "missing"]);

/** Is a cloud computer status (GET /api/bots/:id/computer) asleep: stopped,
 * archived or not created yet. Unknown answers are not asleep. */
export function cloudStatusAsleep(status: { configured?: unknown; box?: { state?: unknown } | null } | null | undefined): boolean {
  if (!status || status.configured !== true) return false;
  const state = typeof status.box?.state === "string" ? status.box.state : null;
  if (state === null) return true;
  if (isReadyBoatState(state)) return false;
  return SLEEPING_BOAT.has(state);
}

/** The bot's cloud computer asleep or not, read without waking it. */
export function useCloudAsleep(botId: string, enabled: boolean, refreshKey?: unknown): boolean {
  const [asleep, setAsleep] = useState(false);
  useEffect(() => {
    if (!enabled) { setAsleep(false); return; }
    let alive = true;
    const read = () => {
      api<{ configured?: unknown; box?: { state?: unknown } | null }>(`/api/bots/${encodeURIComponent(botId)}/computer`)
        .then((status) => { if (alive) setAsleep(cloudStatusAsleep(status)); })
        .catch(() => { /* unknown: keep the last answer */ });
    };
    read();
    const timer = setInterval(read, 30_000);
    return () => { alive = false; clearInterval(timer); };
  }, [botId, enabled, refreshKey]);
  return asleep;
}
