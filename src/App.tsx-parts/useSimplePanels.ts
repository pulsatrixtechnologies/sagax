import { useEffect } from "react";
import type { Action } from "@/state/store";

/** What Simple closes when it comes on. Simple does not offer the
 * inspector, so it closes it and leaves its saved settings as they were.
 * Connect apps stays open in Simple (2026-10-16): its pill is in every
 * sidebar, and a person who chose Simple must still reach it. What they may
 * change inside is the server's call.
 * The bot's computer (the store's computerOpen) stays open too (#4208): it
 * is the request for the Computer section's screen window, which Simple
 * keeps, so Teach a task, a sign-in card's Open and every place link work in
 * Simple as in Advanced. */
export function useSimplePanels(advanced: boolean, inspectorOpen: boolean, dispatch: (action: Action) => void): void {
  useEffect(() => {
    if (advanced) return;
    if (inspectorOpen) dispatch({ type: "toggleInspector", open: false });
  }, [advanced, inspectorOpen, dispatch]);
}
