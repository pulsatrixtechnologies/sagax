// Two person-wide switches for the bot panel (Settings > Appearance), each
// kept on this computer and followed across the person's devices on an
// organization server (shared/user-preferences.ts):
//  - the Suggestions card: shown until the person hides it once ("Hide"),
//    then hidden for every bot; Settings brings it back. It used to be
//    remembered per bot (sagax.botSuggestions.hidden.v1): a person who hid
//    it for any bot is migrated to hidden.
//  - the "All history" row: hidden by default. History stays reachable from
//    the Coding / Activity section titles, the command palette ("<bot>
//    history") and the bot panel.
import { useSyncExternalStore } from "react";
import { localChoice } from "./local-choice";

export const SHOW_SUGGESTIONS_KEY = "sagax.showSuggestions.v1";
export const SHOW_ALL_HISTORY_KEY = "sagax.showAllHistory.v1";
export const LEGACY_SUGGESTIONS_HIDDEN_KEY = "sagax.botSuggestions.hidden.v1";

const ON_OFF = ["1", "0"] as const;
const suggestionsChoice = localChoice(SHOW_SUGGESTIONS_KEY, ON_OFF, "1");
const historyChoice = localChoice(SHOW_ALL_HISTORY_KEY, ON_OFF, "0");

type Store = Pick<Storage, "getItem" | "setItem">;

function localStore(): Store | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

/** True when the old per-bot Hide had hidden suggestions for any bot. */
export function legacyHiddenForAnyBot(store: Store | undefined = localStore()): boolean {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(LEGACY_SUGGESTIONS_HIDDEN_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    return Object.values(parsed).some((list) => Array.isArray(list) && list.some((id) => typeof id === "string"));
  } catch { return false; }
}

/** The one-time move from the per-bot flags: nothing chosen yet and some bot
 * had its suggestions hidden, so the global choice starts hidden. */
export function migrateSuggestionsChoice(store: Store | undefined = localStore()): void {
  try {
    if (!store || store.getItem(SHOW_SUGGESTIONS_KEY) !== null) return;
    if (legacyHiddenForAnyBot(store)) store.setItem(SHOW_SUGGESTIONS_KEY, "0");
  } catch { /* storage off: the default (shown) applies */ }
}

function suggestionsShown(): boolean {
  migrateSuggestionsChoice();
  return suggestionsChoice.get() === "1";
}

export function setShowSuggestions(on: boolean): void { suggestionsChoice.set(on ? "1" : "0"); }
export function useShowSuggestions(): boolean {
  return useSyncExternalStore(suggestionsChoice.subscribe, suggestionsShown, () => true);
}

export function setShowAllHistory(on: boolean): void { historyChoice.set(on ? "1" : "0"); }
export function useShowAllHistory(): boolean {
  return useSyncExternalStore(historyChoice.subscribe, () => historyChoice.get() === "1", () => false);
}

// The command palette asks the open bot panel to show a bot's history, even
// when the "All history" row is hidden. One pending request, picked up by the
// panel when it is (or becomes) mounted.
let pendingHistory: string | null = null;
const historyListeners = new Set<() => void>();

export function requestBotHistory(botId: string): void {
  pendingHistory = botId;
  for (const listener of historyListeners) listener();
}

/** Subscribes; `onRequest` runs now if a request waits for this bot. */
export function watchBotHistoryRequests(botId: string, onRequest: () => void): () => void {
  const check = () => {
    if (pendingHistory !== botId) return;
    pendingHistory = null;
    onRequest();
  };
  historyListeners.add(check);
  check();
  return () => { historyListeners.delete(check); };
}
