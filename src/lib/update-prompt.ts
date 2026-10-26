// The update dialog's two signals. UpdateBanner owns the dialog; these are
// counters it watches, so each click asks again even for the same version.
//
// - openUpdatePrompt: the sidebar's update button reopens the dialog after
//   "Later".
// - requestUpdateCheck: the person's "Check for updates" (account menu >
//   Help, Settings > Updates). The dialog follows that check from start to
//   end: searching, "Sagax X.Y.Z is available" with its notes and the
//   download's progress, "Update ready" with "Restart to install", "Sagax is
//   up to date", or the failure. It never installs: only the dialog's
//   "Restart to install" does (2026-10-19, a Windows report: the menu item
//   restarted into a silent install with no word on screen).
import { useSyncExternalStore } from "react";

let prompts = 0;
let checks = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function openUpdatePrompt(): void {
  prompts += 1;
  notify();
}

/** The person asked to check for updates: show the dialog and follow it. */
export function requestUpdateCheck(): void {
  checks += 1;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The number of times the update dialog was asked for; a change means
 * "show it again". */
export function useUpdatePromptRequests(): number {
  return useSyncExternalStore(subscribe, () => prompts, () => prompts);
}

/** The number of times the person asked to check; a change means "check,
 * and follow the result in the dialog". */
export function useUpdateCheckRequests(): number {
  return useSyncExternalStore(subscribe, () => checks, () => checks);
}
