// The subscription a person starred in Usage › (the account menu) or on
// Settings > Usage (2026-11-03): its percent, with its short name, is the
// one the "Usage" row of the account menu shows. One favorite at a time.
//
// Stored in localStorage under USAGE_FAVORITE_KEY, the plan row's id (as
// GET /api/plan-usage names it). It is one of the keys that follow the
// person on an organization server (shared/user-preferences.ts); on a solo
// server it stays on this device. A favorite whose subscription is gone
// (signed out, disconnected) is kept, and the menu falls back to the usual
// figure until it comes back (src/lib/account-menu.ts, usageSummary).
import { useSyncExternalStore } from "react";

export const USAGE_FAVORITE_KEY = "sagax.usageFavorite.v1";

const MAX_ID = 200;

/** The stored id, or null for none (absent, empty or not a sane id). */
export function parseUsageFavorite(raw: string | null | undefined): string | null {
  const id = raw?.trim();
  if (!id || id.length > MAX_ID || [...id].some((char) => char.charCodeAt(0) < 0x20)) return null;
  return id;
}

// ── the page's store ─────────────────────────────────────────────────────

/** A choice storage refused to keep: it holds for this page. */
let session: { id: string | null } | null = null;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readUsageFavorite(): string | null {
  if (session) return session.id;
  try {
    return parseUsageFavorite(storage()?.getItem(USAGE_FAVORITE_KEY));
  } catch {
    return null;
  }
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== USAGE_FAVORITE_KEY && event.key !== null) return;
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

export function writeUsageFavorite(id: string | null): void {
  const next = parseUsageFavorite(id);
  session = { id: next };
  try {
    const store = storage();
    if (!store) return;
    if (next === null) store.removeItem(USAGE_FAVORITE_KEY);
    else store.setItem(USAGE_FAVORITE_KEY, next);
    session = null;
  } catch {
    // Storage refused: the star holds for this session.
  } finally {
    notify();
  }
}

/** Stars this subscription (replacing any other), or clears it when it is
 * already the favorite. */
export function toggleUsageFavorite(id: string): void {
  writeUsageFavorite(readUsageFavorite() === id ? null : id);
}

export function useUsageFavorite(): string | null {
  return useSyncExternalStore(subscribe, readUsageFavorite, readUsageFavorite);
}
