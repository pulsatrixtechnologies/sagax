// The OS permissions of this computer with the action behind each button
// (#2614). The desktop app decides the action (electron/os-permissions.mjs);
// this hook reads it, runs it, and reads again when the person comes back
// from System Settings (focus, visibility, then a short poll), so a grant
// shows without a restart unless the OS needs one.
import { useCallback, useEffect, useRef, useState } from "react";

import type { OsPermissionId, OsPermissionView, OsPermissionsAnswer } from "../../electron/os-permissions.mjs";
import { t } from "@/lib/i18n";

export type { OsPermissionId, OsPermissionView };

/** How long the hook keeps polling after a button (System Settings has no callback). */
export const PERMISSION_POLL_WINDOW_MS = 60_000;
export const PERMISSION_POLL_MS = 1_500;

const PERMISSION_LINK = /^sagax:\/\/permission\/([a-z]+)\/?$/i;
const PERMISSION_IDS: readonly OsPermissionId[] = ["microphone", "screen", "accessibility", "notifications", "speech", "automation", "fullDisk"];

/** The permission a bot's `sagax://permission/<id>` link names, if any. */
export function parsePermissionLink(href: string | undefined | null): OsPermissionId | null {
  const id = href ? PERMISSION_LINK.exec(href.trim())?.[1] : undefined;
  if (!id) return null;
  return PERMISSION_IDS.find((known) => known.toLowerCase() === id.toLowerCase()) ?? null;
}

export function looksLikePermissionLink(value: string): boolean {
  return /^sagax:\/\/permission\//i.test(value);
}

/** True inside the desktop app that can read and act on OS permissions. */
export function osPermissionsAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.ogb?.permAll === "function" && typeof window.ogb?.permAct === "function";
}

export function useOsPermissions({ captureFailed = false }: { captureFailed?: boolean } = {}): {
  answer: OsPermissionsAnswer | null;
  view: (id: OsPermissionId) => OsPermissionView | null;
  act: (id: OsPermissionId, secondary?: boolean) => Promise<void>;
  busy: OsPermissionId | null;
} {
  const [answer, setAnswer] = useState<OsPermissionsAnswer | null>(null);
  const [busy, setBusy] = useState<OsPermissionId | null>(null);
  const pollUntil = useRef(0);
  const alive = useRef(true);

  const refresh = useCallback(() => {
    const read = typeof window === "undefined" ? undefined : window.ogb?.permAll;
    if (typeof read !== "function") return;
    read({ captureFailed }).then((next) => {
      if (alive.current && next && Array.isArray(next.permissions)) setAnswer(next);
    }).catch(() => { /* an older app: nothing to show */ });
  }, [captureFailed]);

  useEffect(() => {
    alive.current = true;
    refresh();
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(() => { if (Date.now() < pollUntil.current) refresh(); }, PERMISSION_POLL_MS);
    return () => {
      alive.current = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const act = useCallback(async (id: OsPermissionId, secondary = false) => {
    const run = typeof window === "undefined" ? undefined : window.ogb?.permAct;
    if (typeof run !== "function") return;
    setBusy(id);
    pollUntil.current = Date.now() + PERMISSION_POLL_WINDOW_MS;
    try {
      await run(id, {
        secondary,
        captureFailed,
        notification: { title: "Sagax", body: t("osPermission.notifications.test") },
      });
    } catch { /* the next read shows the real state */ } finally {
      if (alive.current) setBusy(null);
      refresh();
    }
  }, [captureFailed, refresh]);

  const view = useCallback((id: OsPermissionId) => answer?.permissions.find((entry) => entry.id === id) ?? null, [answer]);
  return { answer, view, act, busy };
}
