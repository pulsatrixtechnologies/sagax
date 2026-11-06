// Thin hooks for who opened the app. Kept out of WelcomeGate.tsx so the
// shell can mount without parsing the welcome / launch / first-run UI
// modules on every cold start (Refs #1971).
import { useEffect, useState } from "react";
import { LOCAL_VIEWER, welcomeViewer, type WelcomeViewer } from "@/lib/onboarding";
import { api } from "@/state/store";

/** Only the desktop app's own pages get the full bridge; `remoteClient` is
 * part of it. A remote page the desktop app loads (Server → Connect hosted
 * workspace…) gets a reduced, still truthy `window.ogb` without it, and is
 * no more the owner than a browser is. */
export function localDesktopPage(): boolean {
  return window.ogb?.remoteClient !== undefined;
}

/** Null while the answer is on its way. The desktop app's own page knows at
 * once: its own server's owner, or a remote client, which never gets a
 * first-run surface anyway. A failed answer keeps the old behaviour. */
export function useWelcomeViewer(): WelcomeViewer | null {
  const local = localDesktopPage();
  const [viewer, setViewer] = useState<WelcomeViewer | null>(local ? LOCAL_VIEWER : null);
  useEffect(() => {
    if (local) return;
    let active = true;
    void api("/api/auth/session", { timeoutMs: 10_000 })
      .then((session) => {
        if (active) setViewer(welcomeViewer(session));
      })
      .catch(() => {
        if (active) setViewer(LOCAL_VIEWER);
      });
    return () => {
      active = false;
    };
  }, [local]);
  return viewer;
}
