// Where a coding window puts its side content (JC 2026-11-06, #2285): the
// session (status, duration, tokens) and the dev pods (Environment,
// Connectors, Context, Changes, Background tasks, Outputs) live in the bot
// panel's Coding tab on the right, as sections of that panel, not in a
// popover over the transcript. The panel registers a host element per bot;
// the coding window (CodingChat) portals into it. Connectors used to sit at
// the top of Activity; since #2599 (JC 2026-11-07) every pod is in Coding.
import { useSyncExternalStore } from "react";

const hosts = new Map<string, HTMLElement>();
const listeners = new Set<() => void>();

export function setCodingPanelHost(botId: string, element: HTMLElement | null): void {
  if (element) hosts.set(botId, element);
  else hosts.delete(botId);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The bot panel's host for this bot's coding window, while it is on screen. */
export function useCodingPanelHost(botId: string | undefined): HTMLElement | null {
  return useSyncExternalStore(subscribe, () => (botId ? hosts.get(botId) ?? null : null), () => null);
}
