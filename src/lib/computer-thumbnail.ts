// The bot panel's Computer row thumbnail (2026-11-06, JC: "the desktop
// picture need to be a screenshot of the bot's pc"; "I am switching to my
// mac, it should be my mac"). The picture is the newest capture of the
// computer the bot works on now (server/routes/computer-thumbnail.ts):
// switching computers asks for that computer's picture at once and never
// shows the previous one. On the person's own computer the desktop app also
// sends a small capture of it (electron/screen-thumbnail.mjs), only once
// Screen Recording is granted, so no prompt ever comes from the panel.
import { useCallback, useEffect, useRef, useState } from "react";

import type { Bot } from "@/state/store";
import { api } from "@/state/store/api";
import type { DesktopBridgeDesktop, DesktopBridgeStatus } from "@/lib/desktop-bridge";

/** How often the row asks again while it is on screen. */
export const COMPUTER_THUMBNAIL_REFRESH_MS = 30_000;
/** A capture older than this is drawn greyed out, its time in the tooltip. */
export const COMPUTER_THUMBNAIL_STALE_MS = 15 * 60_000;

const DESKTOP_ID = /^[\w.-]{1,80}$/;

/** The person's computer the row stands for: the one online now, else the
 * one seen last (asleep or offline: its last capture, greyed out). */
export function thumbnailDesktop(bridge: DesktopBridgeStatus | null): { desktop: DesktopBridgeDesktop; online: boolean } | null {
  const desktops = [...(bridge?.desktops ?? [])].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  const online = desktops.find((desktop) => desktop.online);
  if (online) return { desktop: online, online: true };
  return desktops[0] ? { desktop: desktops[0], online: false } : null;
}

/** Which computer's picture the row shows; null where the bot has no
 * computer (Off, the browser only). On an organization server "This
 * computer" is the person's own desktop (local:<desktop id>); on a solo
 * server it is the computer the server runs on (local). */
export function thumbnailComputerFor(computer: Bot["computer"] | null | undefined, bridge: DesktopBridgeStatus | null, organization = false): string | null {
  const mode = computer ?? null;
  if (mode === null) return "auto";
  if (mode === "off" || mode === "browser") return null;
  if (mode === "local") {
    const id = organization ? thumbnailDesktop(bridge)?.desktop.id : undefined;
    return id && DESKTOP_ID.test(id) ? `local:${id}` : "local";
  }
  return mode;
}

export function computerThumbnailUrl(botId: string, computer: string, at: number, size: "thumb" | "full" = "thumb"): string {
  const query = new URLSearchParams({ computer, v: String(at) });
  if (size === "full") query.set("size", "full");
  return `/api/bots/${encodeURIComponent(botId)}/computer/thumbnail?${query.toString()}`;
}

/** Host names compared the way macOS shows them ("Mac.local" is "mac"). */
export function sameHost(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (value: string | null | undefined) => (value ?? "").trim().toLowerCase().replace(/\.+$/, "").replace(/\.local$/, "");
  return norm(a) !== "" && norm(a) === norm(b);
}

export interface ComputerThumbnailState {
  computer: string | null;
  at: number | null;
  src: string | null;
  fullSrc: string | null;
}

/** The row's picture for `computer`, refreshed while the page is visible,
 * every COMPUTER_THUMBNAIL_REFRESH_MS and whenever `refreshKey` changes (each
 * bot action). `desktopName`: the person's computer the row stands for (null
 * on a solo server, where "local" is this computer). */
export function useComputerThumbnail(botId: string, computer: string | null, options: { desktopName?: string | null; refreshKey?: unknown; enabled?: boolean } = {}): ComputerThumbnailState {
  const { desktopName = null, refreshKey, enabled = true } = options;
  const [state, setState] = useState<{ computer: string | null; at: number | null }>({ computer, at: null });
  const live = useRef(computer);
  live.current = computer;
  // Another computer: forget the previous picture before anything is asked.
  if (state.computer !== computer) setState({ computer, at: null });

  const refresh = useCallback(async () => {
    if (!computer || !enabled) return;
    if (computer.startsWith("local")) await sendOwnCapture(botId, computer, desktopName);
    try {
      const meta = await api<{ at: number | null }>(`/api/bots/${encodeURIComponent(botId)}/computer/thumbnail?computer=${encodeURIComponent(computer)}&format=json`);
      if (live.current !== computer) return;
      const at = typeof meta?.at === "number" ? meta.at : null;
      setState((previous) => previous.computer === computer && previous.at === at ? previous : { computer, at });
    } catch {
      // An older server or a refused view: the row keeps its wallpaper.
    }
  }, [botId, computer, desktopName, enabled]);

  useEffect(() => {
    if (!computer || !enabled) return;
    void refresh();
    const timer = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState !== "hidden") void refresh();
    }, COMPUTER_THUMBNAIL_REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, computer, enabled, refreshKey]);

  const at = state.computer === computer ? state.at : null;
  return {
    computer,
    at,
    src: computer && at !== null ? computerThumbnailUrl(botId, computer, at) : null,
    fullSrc: computer && at !== null ? computerThumbnailUrl(botId, computer, at, "full") : null,
  };
}

/** The desktop app's capture of this computer, sent when this computer is the
 * one the row stands for. Never prompts: the app captures only once Screen
 * Recording is granted. */
async function sendOwnCapture(botId: string, computer: string, desktopName: string | null): Promise<void> {
  const capture = typeof window === "undefined" ? undefined : window.ogb?.screenThumbnail;
  if (!capture) return;
  try {
    const shot = await capture();
    if (!shot?.image) return;
    if (desktopName !== null && !sameHost(shot.host, desktopName)) return;
    await api(`/api/bots/${encodeURIComponent(botId)}/computer/thumbnail?computer=${encodeURIComponent(computer)}`, {
      method: "PUT",
      body: JSON.stringify({ image: shot.image }),
    });
  } catch {
    // No capture this time: the last one stays.
  }
}
