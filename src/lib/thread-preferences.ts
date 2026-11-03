import { useSyncExternalStore } from "react";

export const SHOW_THREADS_KEY = "omb-show-threads";

// Only a renderer preference: no conversation or server configuration belongs
// here. Keep a session choice even if private/blocked storage rejects reads or
// writes; another window's storage event can supersede that choice.
//
// Off by default since 2026-10-17 (the single stream is the default
// mode, docs/single-stream-orchestration.md): a person who never chose (no
// stored value, or storage that cannot be read) sees one continuous
// conversation per bot. "1" is a recorded on, so whoever turned threads on
// keeps them; any other stored value (the switch writes "0") is a recorded
// off. On an organization server the value travels as the synced key
// `omb-show-threads` (shared/user-preferences.ts); an absent key means unset,
// so the server holds no default of its own.
let sessionChoice: boolean | undefined;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export const SHOW_THREADS_DEFAULT = false;

function showThreads(): boolean {
  if (sessionChoice !== undefined) return sessionChoice;
  try {
    const stored = storage()?.getItem(SHOW_THREADS_KEY);
    // Only a missing value is "unset". Any stored value keeps its old reading
    // ("1" is on, everything else is off), so nobody who chose off is moved.
    return stored === null || stored === undefined ? SHOW_THREADS_DEFAULT : stored === "1";
  } catch {
    return SHOW_THREADS_DEFAULT;
  }
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== SHOW_THREADS_KEY && event.key !== null) return;
  if (event.storageArea && event.storageArea !== storage()) return;
  sessionChoice = undefined;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

export function setShowThreads(enabled: boolean): void {
  sessionChoice = enabled;
  try {
    storage()?.setItem(SHOW_THREADS_KEY, enabled ? "1" : "0");
  } catch {
    // The visible setting still changes for this session when storage is full.
  }
  notify();
}

/** What a send to a bot carries: whether this client shows one continuous
 * conversation (threads off). The server then treats the thread as a segment
 * of that stream: the bot gets the digest of the earlier topics and
 * recall_topic (server/streams/single-stream.ts). Read at send time, never cached. */
export function singleStreamTurnField(): { singleStream: boolean } {
  return { singleStream: !showThreads() };
}

/** The person's own choice in Settings > Appearance, whatever the mode. */
export function useShowThreadsChoice(): boolean {
  return useSyncExternalStore(subscribe, showThreads, () => SHOW_THREADS_DEFAULT);
}

/** Whether the sidebar shows threads: the person's choice, in Simple and
 * Advanced mode alike. Off by default (AGENTS.md, "Single stream is the
 * default"): one conversation per bot until the person turns threads on. */
export function useShowThreads(): boolean {
  return useShowThreadsChoice();
}

// Where thread mode lists threads and folders. One place at a time, never both:
// "header" is the chat header's thread button (default), "sidebar" lists them
// under each bot in the left sidebar. A per-device renderer preference: the
// key is not synced to an organization server.
export const THREADS_LOCATION_KEY = "omb-threads-location";
export type ThreadsLocation = "header" | "sidebar";
export const THREADS_LOCATION_DEFAULT: ThreadsLocation = "header";
let sessionLocation: ThreadsLocation | undefined;

function threadsLocation(): ThreadsLocation {
  if (sessionLocation !== undefined) return sessionLocation;
  try {
    return storage()?.getItem(THREADS_LOCATION_KEY) === "sidebar" ? "sidebar" : THREADS_LOCATION_DEFAULT;
  } catch {
    return THREADS_LOCATION_DEFAULT;
  }
}

function onLocationStorage(event: StorageEvent) {
  if (event.key !== THREADS_LOCATION_KEY && event.key !== null) return;
  if (event.storageArea && event.storageArea !== storage()) return;
  sessionLocation = undefined;
  notify();
}

function subscribeLocation(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window !== "undefined") window.addEventListener("storage", onLocationStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onLocationStorage);
  };
}

export function setThreadsLocation(location: ThreadsLocation): void {
  sessionLocation = location;
  try {
    storage()?.setItem(THREADS_LOCATION_KEY, location);
  } catch {
    // The visible setting still changes for this session when storage is full.
  }
  notify();
}

/** The person's own choice in Settings > Appearance (applies when threads are on). */
export function useThreadsLocationChoice(): ThreadsLocation {
  return useSyncExternalStore(subscribeLocation, threadsLocation, () => THREADS_LOCATION_DEFAULT);
}

/** Settings > Conversations > Conversation threads, as one value: the one
 * place every surface reads (a single choice, a single reader).
 * - "one": one conversation per bot. No thread is a sidebar line, a header
 *   control or a destination; another thread opens beside it.
 * - "header": threads are chosen in the chat header only; the sidebar has
 *   one line per bot, no sub-rows and no chevron.
 * - "sidebar": each bot folds open on its threads in the sidebar; nothing
 *   about threads in the chat header. */
export type ThreadsMode = "one" | "header" | "sidebar";

export function threadsModeOf(showThreads: boolean, location: ThreadsLocation): ThreadsMode {
  return !showThreads ? "one" : location;
}

/** The current mode, outside React (the store's actions). */
export function threadsMode(): ThreadsMode {
  return threadsModeOf(showThreads(), threadsLocation());
}

export function useThreadsMode(): ThreadsMode {
  return threadsModeOf(useShowThreadsChoice(), useThreadsLocationChoice());
}
