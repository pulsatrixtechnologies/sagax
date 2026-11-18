// The providers a person pinned to the model panel's segment row (2026-11-18:
// "show max 3 providers and a way to open an advanced view that shows them
// all"). The row shows Auto, Favorites, the pinned providers (at most three),
// then "More", which opens the Models window where each provider carries its
// pin. With nothing pinned, the row shows the bot's own provider and the two
// providers whose models the person starred most (catalog order after that).
//
// Stored in localStorage under MODEL_PROVIDER_PINS_KEY, one of the keys that
// follow the person to every device on an organization server
// (shared/user-preferences.ts); on a solo server it stays on this device.
// A pin names a provider by its catalog id (shared/model-provider.ts); one
// whose provider is gone is kept (it comes back with it) and not shown.
import { useSyncExternalStore } from "react";

export const MODEL_PROVIDER_PINS_KEY = "sagax.modelProviderPins.v1";
export const MAX_PROVIDER_PINS = 3;
const MAX_ID = 200;

const EMPTY: readonly string[] = Object.freeze([]);

/** The stored value: `["anthropic", ...]`, in the order pinned. Anything
 * else (or a broken entry) is dropped. */
export function parseProviderPins(raw: string | null | undefined): readonly string[] {
  if (!raw) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    const pins: string[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "string" || !entry || entry.length > MAX_ID || pins.includes(entry)) continue;
      pins.push(entry);
    }
    return pins.slice(0, MAX_PROVIDER_PINS);
  } catch {
    return EMPTY;
  }
}

export function serializeProviderPins(pins: readonly string[]): string {
  return JSON.stringify(pins.slice(0, MAX_PROVIDER_PINS));
}

/** One provider the menu lists, with what the default choice reads. */
export interface PinCandidate {
  key: string;
  /** How many of its models the person starred. */
  starred: number;
  /** The bot's model is one of its models. */
  current: boolean;
}

/** What shows when nothing is pinned: the current provider, then the most
 * starred (a tie keeps the catalog's order). */
export function defaultProviderPins(candidates: readonly PinCandidate[]): string[] {
  const current = candidates.filter((candidate) => candidate.current).map((candidate) => candidate.key);
  const rest = candidates
    .map((candidate, order) => ({ candidate, order }))
    .filter(({ candidate }) => !candidate.current)
    .sort((a, b) => b.candidate.starred - a.candidate.starred || a.order - b.order)
    .map(({ candidate }) => candidate.key);
  return [...current, ...rest].slice(0, MAX_PROVIDER_PINS);
}

/** The pins in effect: the person's own (those whose provider is still
 * listed), else the default. */
export function effectiveProviderPins(stored: readonly string[], candidates: readonly PinCandidate[]): string[] {
  const listed = new Set(candidates.map((candidate) => candidate.key));
  const own = stored.filter((key) => listed.has(key));
  return own.length > 0 ? own : defaultProviderPins(candidates);
}

export type PinChange = { pins: readonly string[] } | { refused: "full" };

/** Pins the provider, or unpins it when it is pinned. A fourth pin is
 * refused: nothing changes and the caller says to unpin one first. */
export function withProviderPinToggled(pins: readonly string[], key: string): PinChange {
  if (pins.includes(key)) return { pins: pins.filter((candidate) => candidate !== key) };
  if (pins.length >= MAX_PROVIDER_PINS) return { refused: "full" };
  return { pins: [...pins, key] };
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

export function readProviderPins(): readonly string[] {
  if (session) return session;
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(MODEL_PROVIDER_PINS_KEY) ?? null;
  } catch {
    raw = null;
  }
  // useSyncExternalStore needs the same array while the value is the same.
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedValue = parseProviderPins(raw);
  }
  return cachedValue;
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== MODEL_PROVIDER_PINS_KEY && event.key !== null) return;
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

export function writeProviderPins(next: readonly string[]): void {
  session = next;
  try {
    storage()?.setItem(MODEL_PROVIDER_PINS_KEY, serializeProviderPins(next));
    session = null;
  } catch {
    // Storage refused: the pins hold for this session.
  }
  notify();
}

export function useProviderPins(): readonly string[] {
  return useSyncExternalStore(subscribe, readProviderPins, readProviderPins);
}
