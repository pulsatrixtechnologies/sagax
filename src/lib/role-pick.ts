// Visible roles, batch 3 (2026-11-05): the role the person picked in the
// composer for the NEXT turn of one thread. Kept in memory only, per bot and
// thread; sending a message takes it (one turn), a failed send puts it back.
// "" is "Moi" (the person's own access); no entry: nothing picked.
import { useSyncExternalStore } from "react";

const picks = new Map<string, string>();
const listeners = new Set<() => void>();
const key = (botId: string, threadId: string) => `${botId}:${threadId}`;
const changed = () => { for (const listener of listeners) listener(); };

export function pickRole(botId: string, threadId: string, slug: string | undefined): void {
  if (slug === undefined) picks.delete(key(botId, threadId));
  else picks.set(key(botId, threadId), slug);
  changed();
}

export function rolePick(botId: string, threadId: string): string | undefined {
  return picks.get(key(botId, threadId));
}

/** The pick for the message being sent, cleared at once. */
export function takeRolePick(botId: string, threadId: string): string | undefined {
  const slug = picks.get(key(botId, threadId));
  if (slug !== undefined) { picks.delete(key(botId, threadId)); changed(); }
  return slug;
}

export function useRolePick(botId: string, threadId: string): string | undefined {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => rolePick(botId, threadId),
    () => rolePick(botId, threadId),
  );
}
