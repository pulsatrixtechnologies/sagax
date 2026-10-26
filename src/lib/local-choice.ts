// A choice kept on this computer in localStorage under one key, read the way
// the other preference modules read theirs: a session value survives blocked
// storage, another window's (or a bot's, applyBotPreference) `storage` event
// supersedes it. Values outside `allowed` read as the fallback.
import { useSyncExternalStore } from "react";

export interface LocalChoice<T extends string> {
  key: string;
  get(): T;
  set(next: T): void;
  subscribe(listener: () => void): () => void;
  use(): T;
}

export function localChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): LocalChoice<T> {
  let session: T | undefined;
  const listeners = new Set<() => void>();
  const store = (): Storage | undefined => {
    try { return globalThis.localStorage; } catch { return undefined; }
  };
  const fits = (value: unknown): value is T => typeof value === "string" && (allowed as readonly string[]).includes(value);
  const get = (): T => {
    if (session !== undefined) return session;
    try {
      const raw = store()?.getItem(key);
      return fits(raw) ? raw : fallback;
    } catch {
      return fallback;
    }
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== key && event.key !== null) return;
    if (event.storageArea && event.storageArea !== store()) return;
    session = undefined;
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
    };
  };
  const set = (next: T) => {
    if (!fits(next)) return;
    session = next;
    try {
      const local = store();
      local?.setItem(key, next);
      if (local?.getItem(key) === next) session = undefined;
    } catch {
      // the visible setting still changes for this session when storage is full
    }
    for (const listener of listeners) listener();
  };
  return { key, get, set, subscribe, use: () => useSyncExternalStore(subscribe, get, () => fallback) };
}
