// #4416: the model list each key's own account offers, read live and kept
// per key. The key itself is never stored: a one-way fingerprint names the
// entry. A failed or empty lookup keeps the last good list for that key;
// a key never read successfully gets the written list.
import { createHash } from "node:crypto";

import type { ModelCatalog } from "../contracts.ts";

/** How long a key's list serves before the next view reads it again. */
export const KEY_MODEL_CATALOG_TTL_MS = 10 * 60_000;

/** How many keys keep a list. Past it, the key used least recently drops
 * out (a replaced or removed key is never read again). */
export const KEY_MODEL_CATALOG_MAX_KEYS = 64;

interface Entry {
  catalog: ModelCatalog | null;
  /** When the last read ended; absent before the first. */
  at?: number;
  pending?: Promise<ModelCatalog | null>;
}

export interface KeyModelCatalogs {
  /** The list `key`'s account offers: a fresh one at once, a stale one at
   * once while it is read again behind, and the first one waited for. */
  forKey(key: string, read: () => Promise<ModelCatalog | null>): Promise<ModelCatalog>;
}

export function keyFingerprint(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 32);
}

export function createKeyModelCatalogs(options: {
  fallback: () => ModelCatalog;
  ttlMs?: number;
  now?: () => number;
  maxKeys?: number;
}): KeyModelCatalogs {
  const ttl = options.ttlMs ?? KEY_MODEL_CATALOG_TTL_MS;
  const maxKeys = Math.max(1, options.maxKeys ?? KEY_MODEL_CATALOG_MAX_KEYS);
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry>();
  const refresh = (entry: Entry, read: () => Promise<ModelCatalog | null>): Promise<ModelCatalog | null> => {
    if (entry.pending) return entry.pending;
    entry.pending = read()
      .then((next) => (next && next.options.length ? next : null))
      .catch(() => null)
      .then((next) => {
        // A failed or empty lookup keeps the last good list, and is tried
        // again after the same wait as a good one.
        if (next) entry.catalog = next;
        entry.at = now();
        entry.pending = undefined;
        return entry.catalog;
      });
    return entry.pending;
  };
  return {
    async forKey(key, read) {
      const id = keyFingerprint(key);
      const entry: Entry = entries.get(id) ?? { catalog: null };
      // Most recent last: a Map keeps insertion order, so the first key is
      // the one used least recently.
      entries.delete(id);
      entries.set(id, entry);
      while (entries.size > maxKeys) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      if (entry.at !== undefined && now() - entry.at < ttl) return entry.catalog ?? options.fallback();
      if (entry.catalog) {
        void refresh(entry, read);
        return entry.catalog;
      }
      return (await refresh(entry, read)) ?? options.fallback();
    },
  };
}
