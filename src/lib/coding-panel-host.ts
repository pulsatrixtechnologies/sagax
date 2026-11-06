// Where a coding window puts its side content (JC 2026-11-06, #2285): the
// session (status, duration, tokens) and the dev pods (Environment,
// Connectors, Context, Changes, Background tasks) live in the bot panel on
// the right, as sections of that panel, not in a popover over the
// transcript. The panel registers a host element per bot; the coding
// window (CodingChat) portals into it.
//
// Two hosts per bot (JC 2026-11-06): "coding" is the panel's Coding tab,
// shown only while a coding chat is open (the session, Environment, Context,
// Changes, Background tasks, Outputs); "activity" is the top of Activity, for
// what is not coding work of its own (Connectors).
import { useSyncExternalStore } from "react";

export type CodingPanelSlot = "coding" | "activity";

const hosts = new Map<string, HTMLElement>();
const keyOf = (botId: string, slot: CodingPanelSlot) => `${slot}:${botId}`;
const listeners = new Set<() => void>();

export function setCodingPanelHost(botId: string, element: HTMLElement | null, slot: CodingPanelSlot = "coding"): void {
  if (element) hosts.set(keyOf(botId, slot), element);
  else hosts.delete(keyOf(botId, slot));
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The bot panel's host for this bot's coding window, while it is on screen. */
export function useCodingPanelHost(botId: string | undefined, slot: CodingPanelSlot = "coding"): HTMLElement | null {
  return useSyncExternalStore(subscribe, () => (botId ? hosts.get(keyOf(botId, slot)) ?? null : null), () => null);
}
