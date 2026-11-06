// The models a person starred in the composer's model menu (2026-10-14, :
// "too many models shown"): they sit right under Auto, so the usual few are
// one click away while every provider folds into a submenu.
//
// Stored in localStorage under MODEL_FAVORITES_KEY, one of the keys that
// follow the person to every device on an organization server
// (shared/user-preferences.ts). On a solo server it stays on this device.
// A favorite names an engine and a model id; one whose engine or model is
// gone is kept (it comes back with them) and simply not shown.
//
// #2050 (Settings > Models redesign): the stars also live beside the
// person's model switches on the server (`favoriteModels` of GET/PUT
// /api/me/models, `<engine>/<model>` keys), so they follow the person
// without depending on the preference sync. `attachModelFavoritesServer`
// wires that once per session: the server's list wins when it has stars,
// a local list is pushed when the server has none, and every star or
// unstar after that is sent.
import { useSyncExternalStore } from "react";

import { modelKey, parseModelKey } from "../../shared/offered-models";

export const MODEL_FAVORITES_KEY = "sagax.modelFavorites.v1";

/** A bound, not a quota: the value must fit one preference (8 KiB). */
export const MAX_FAVORITES = 40;
const MAX_ID = 200;

/** The id of a favorite, the same as the menu row's key for that model. */
export function favoriteKey(instanceId: string, modelId: string): string {
  return `${instanceId}\u0000${modelId}`;
}

function splitKey(key: string): [string, string] | null {
  const at = key.indexOf("\u0000");
  if (at <= 0 || at === key.length - 1) return null;
  return [key.slice(0, at), key.slice(at + 1)];
}

const EMPTY: readonly string[] = Object.freeze([]);

/** The stored value: `[[instanceId, modelId], ...]`, oldest first. Anything
 * else (or a broken entry) is dropped. */
export function parseModelFavorites(raw: string | null | undefined): readonly string[] {
  if (!raw) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    const keys: string[] = [];
    for (const entry of parsed) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [instanceId, modelId] = entry as unknown[];
      if (typeof instanceId !== "string" || typeof modelId !== "string") continue;
      if (!instanceId || !modelId || instanceId.length > MAX_ID || modelId.length > MAX_ID || instanceId.includes("\u0000")) continue;
      const key = favoriteKey(instanceId, modelId);
      if (!keys.includes(key)) keys.push(key);
    }
    return keys.slice(-MAX_FAVORITES);
  } catch {
    return EMPTY;
  }
}

export function serializeModelFavorites(keys: readonly string[]): string {
  return JSON.stringify(keys.slice(-MAX_FAVORITES).map(splitKey).filter(Boolean));
}

/** Adds the model at the end, or removes it when it is already there. */
export function withFavoriteToggled(keys: readonly string[], key: string): readonly string[] {
  if (!splitKey(key)) return keys;
  return keys.includes(key) ? keys.filter((candidate) => candidate !== key) : [...keys, key].slice(-MAX_FAVORITES);
}

// ── the page's store ─────────────────────────────────────────────────────

let session: readonly string[] | null = null;
let cachedRaw: string | null | undefined;
let cachedValue: readonly string[] = EMPTY;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readModelFavorites(): readonly string[] {
  if (session) return session;
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(MODEL_FAVORITES_KEY) ?? null;
  } catch {
    raw = null;
  }
  // useSyncExternalStore needs the same array while the value is the same.
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedValue = parseModelFavorites(raw);
  }
  return cachedValue;
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== MODEL_FAVORITES_KEY && event.key !== null) return;
  session = null;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined" && typeof window.addEventListener === "function") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined" && typeof window.removeEventListener === "function") window.removeEventListener("storage", onStorage);
  };
}

function applyLocal(next: readonly string[]): void {
  session = next;
  try {
    storage()?.setItem(MODEL_FAVORITES_KEY, serializeModelFavorites(next));
    session = null;
  } catch {
    // Storage refused: the stars hold for this session.
  }
  notify();
}

export function writeModelFavorites(next: readonly string[]): void {
  applyLocal(next);
  if (server) void server.save(toServerFavorites(next)).catch(() => undefined);
}

// ── the server copy (#2050) ──────────────────────────────────────────────

export interface ModelFavoritesServer {
  /** The person's list on the server, `<engine>/<model>` each; undefined
   * when the server has no such list (signed out, older server). */
  load(): Promise<readonly string[] | undefined>;
  save(list: readonly string[]): Promise<unknown>;
}

let server: ModelFavoritesServer | null = null;
let loading: Promise<void> | null = null;

/** Menu row keys to the server's `<engine>/<model>` form. */
export function toServerFavorites(keys: readonly string[]): string[] {
  const out: string[] = [];
  for (const key of keys) {
    const parts = splitKey(key);
    if (parts) out.push(modelKey(parts[0], parts[1]));
  }
  return out;
}

/** The server's `<engine>/<model>` list to menu row keys. */
export function fromServerFavorites(list: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const entry of list) {
    if (typeof entry !== "string") continue;
    const parsed = parseModelKey(entry);
    if (parsed) out.push(favoriteKey(parsed.instanceId, parsed.model));
  }
  return out.slice(-MAX_FAVORITES);
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((key, i) => key === b[i]);

/** Attaches (or detaches, with null) the server copy. The first attach
 * loads once: the server's stars replace the local ones when it has some,
 * else the local ones are pushed. A failed load is retried on the next
 * attach. Returns when that first exchange is done. */
export function attachModelFavoritesServer(next: ModelFavoritesServer | null): Promise<void> {
  server = next;
  if (!next) {
    loading = null;
    return Promise.resolve();
  }
  if (loading) return loading;
  loading = (async () => {
    try {
      const remote = await next.load();
      if (!remote || server !== next) return;
      const remoteKeys = fromServerFavorites(remote);
      const local = readModelFavorites();
      if (remoteKeys.length) {
        if (!sameList(remoteKeys, local)) applyLocal(remoteKeys);
      } else if (local.length) {
        await next.save(toServerFavorites(local));
      }
    } catch {
      loading = null; // next attach tries again
    }
  })();
  return loading;
}

export function toggleModelFavorite(key: string): void {
  writeModelFavorites(withFavoriteToggled(readModelFavorites(), key));
}

export function useModelFavorites(): readonly string[] {
  return useSyncExternalStore(subscribe, readModelFavorites, readModelFavorites);
}
