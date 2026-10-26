// A person's preferences follow them on an organization server
// (shared/user-preferences.ts, server/routes/user-preferences.ts).
//
// The modules that own each preference keep reading and writing
// localStorage, unchanged. On a page served by an organization server (in a
// browser, or the desktop app in server mode) this module:
//   1. at start, before the app renders, reads the person's record from the
//      server and writes it into localStorage, so the server wins;
//   2. the first time (no record yet), saves what this person already had:
//      the preferences the desktop app brought from this computer's solo app
//      (handed over once by the launch screen, never asked), else what this
//      page already held. The local copy is never removed;
//   3. then watches those keys and saves a change back to the server: only
//      the keys that changed (PATCH { set, remove }), so a page that missed
//      another device's edit never writes its old copy of other keys back
//      (a section deleted on the phone stays deleted); an older server
//      without PATCH gets the whole record (PUT), as before;
//   4. applies the record the server sends after every save, from any of the
//      person's devices (the `preferences` frame, their own streams only), to
//      each key this page has not changed meanwhile, and tells the modules
//      with a `storage` event for that key so they read it again.
// Anywhere else the server answers 404 and nothing here runs.
import { DEVICE_PREFERENCE_KEYS } from "../../shared/settings-actions";
import { USER_PREFERENCE_KEYS, cleanUserPreferences, type UserPreferences } from "../../shared/user-preferences";

export const PREFERENCES_PATH = "/api/me/preferences";
const WATCH_MS = 1_500;
/** The window event the store raises with a `preferences` frame. */
export const PREFERENCES_EVENT = "sagax:preferences";
/** Reading the record again when the window comes back, at most this often. */
const REFRESH_MS = 30_000;

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

export interface PreferenceSyncDeps {
  fetch: typeof fetch;
  storage: Storage;
  /** The solo app's preferences, handed over once by the desktop (org-join). */
  takeLocalPreferences?: () => Promise<unknown>;
  setInterval?: (fn: () => void, ms: number) => unknown;
  /** A key the server changed on this page: the modules read it again. */
  notify?: (key: string) => void;
  timeoutMs?: number;
}

/** The known keys as this page holds them now. */
export function readPreferences(storage: Storage): UserPreferences {
  const out: UserPreferences = {};
  for (const key of USER_PREFERENCE_KEYS) {
    try {
      const value = storage.getItem(key);
      if (value !== null) out[key] = value;
    } catch {
      /* storage refused: nothing to read */
    }
  }
  return out;
}

/** The server's record becomes this page's: set what it has, clear what it
 * does not (absent means the module's default, as on a fresh device). */
export function applyPreferences(storage: Storage, preferences: UserPreferences): void {
  for (const key of USER_PREFERENCE_KEYS) {
    try {
      const value = preferences[key];
      if (value === undefined) storage.removeItem(key);
      else storage.setItem(key, value);
    } catch {
      /* storage refused: the defaults show */
    }
  }
}

const same = (a: UserPreferences, b: UserPreferences) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

/** What changed from `from` to `to`: the keys to set and the keys to remove. */
export function preferenceChanges(from: UserPreferences, to: UserPreferences): { set: UserPreferences; remove: string[] } {
  const set: UserPreferences = {};
  const remove: string[] = [];
  for (const key of USER_PREFERENCE_KEYS) {
    if (to[key] === from[key]) continue;
    if (to[key] === undefined) remove.push(key);
    else set[key] = to[key];
  }
  return { set, remove };
}

async function put(deps: PreferenceSyncDeps, preferences: UserPreferences, keepalive = false): Promise<boolean> {
  try {
    const response = await deps.fetch(PREFERENCES_PATH, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preferences }),
      credentials: "same-origin",
      keepalive,
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** "saved", "unsupported" (an older server: no PATCH) or "failed". */
async function patch(deps: PreferenceSyncDeps, changes: { set: UserPreferences; remove: string[] }, keepalive = false): Promise<"saved" | "unsupported" | "failed"> {
  try {
    const response = await deps.fetch(PREFERENCES_PATH, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(changes),
      credentials: "same-origin",
      keepalive,
    });
    if (response.ok) return "saved";
    // an older server: no PATCH in its route (405) or in its member allow list (403, 404)
    return response.status === 403 || response.status === 404 || response.status === 405 ? "unsupported" : "failed";
  } catch {
    return "failed";
  }
}

export interface PreferenceSync {
  /** Saves what changed on this page since the last save or server record. */
  check: () => Promise<void>;
  /** The same, as the page goes away. */
  flush: () => void;
  /** Applies a record the server sent; returns the keys it changed here. */
  receive: (record: unknown) => string[];
  /** Reads the record again and applies it. */
  refresh: () => Promise<void>;
}

/**
 * Runs steps 1 and 2 and returns the watcher for steps 3 and 4 (null when
 * this page keeps its preferences to itself). Never throws; at worst the
 * page keeps what it had.
 */
export async function startPreferenceSync(deps: PreferenceSyncDeps): Promise<PreferenceSync | null> {
  let record = null as { stored?: unknown; preferences?: unknown } | null;
  try {
    const response = await deps.fetch(PREFERENCES_PATH, { credentials: "same-origin", signal: AbortSignal.timeout(deps.timeoutMs ?? 2_000) });
    if (!response.ok) return null;
    record = (await response.json()) as typeof record;
  } catch {
    return null;
  }
  // `pushed` is what the server holds as far as this page knows: a key whose
  // local value differs from it is this page's own unsaved change.
  let pushed: UserPreferences;
  if (record?.stored === true) {
    pushed = cleanUserPreferences(record.preferences);
    applyPreferences(deps.storage, pushed);
  } else {
    let brought: UserPreferences = {};
    try {
      brought = cleanUserPreferences(await deps.takeLocalPreferences?.());
    } catch {
      brought = {};
    }
    const first = Object.keys(brought).length ? brought : readPreferences(deps.storage);
    pushed = {};
    if (Object.keys(first).length) {
      applyPreferences(deps.storage, first);
      // Not saved (offline): the next start offers them again.
      if (await put(deps, first)) pushed = first;
    }
  }
  let patchable = true;
  let busy = false;
  const check = async () => {
    if (busy) return;
    const now = readPreferences(deps.storage);
    if (same(now, pushed)) return;
    busy = true;
    try {
      const changes = preferenceChanges(pushed, now);
      let result: "saved" | "unsupported" | "failed" = "unsupported";
      if (patchable) result = await patch(deps, changes);
      if (result === "unsupported") {
        patchable = false;
        if (await put(deps, now)) pushed = now;
        return;
      }
      if (result === "saved") {
        const next = { ...pushed, ...changes.set };
        for (const key of changes.remove) delete next[key as keyof UserPreferences];
        pushed = next;
      }
    } finally {
      busy = false;
    }
  };
  const flush = () => {
    const now = readPreferences(deps.storage);
    if (same(now, pushed)) return;
    if (patchable) void patch(deps, preferenceChanges(pushed, now), true);
    else void put(deps, now, true);
  };
  const receive = (incoming: unknown) => {
    const server = cleanUserPreferences(incoming && typeof incoming === "object" ? (incoming as { preferences?: unknown }).preferences : undefined);
    const local = readPreferences(deps.storage);
    const changed: string[] = [];
    for (const key of USER_PREFERENCE_KEYS) {
      // changed here and not saved yet: this page's value stands, and goes next
      if (local[key] !== pushed[key]) continue;
      if (server[key] === local[key]) continue;
      try {
        if (server[key] === undefined) deps.storage.removeItem(key);
        else deps.storage.setItem(key, server[key]);
        changed.push(key);
      } catch {
        /* storage refused: this page keeps what it shows */
      }
    }
    pushed = server;
    for (const key of changed) deps.notify?.(key);
    return changed;
  };
  const refresh = async () => {
    try {
      const response = await deps.fetch(PREFERENCES_PATH, { credentials: "same-origin", signal: AbortSignal.timeout(deps.timeoutMs ?? 2_000) });
      if (!response.ok) return;
      const fresh = (await response.json()) as { stored?: unknown };
      if (fresh?.stored === true) receive(fresh);
    } catch {
      /* offline: the next frame or refresh catches up */
    }
  };
  (deps.setInterval ?? setInterval)(() => void check(), WATCH_MS);
  return { check, flush, receive, refresh };
}

/** The store hands a `preferences` frame here (src/state/store.tsx). */
export function announceServerPreferences(frame: { preferences?: unknown; updatedAt?: unknown }): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PREFERENCES_EVENT, { detail: frame }));
}

/** A bot set one of the person's preferences (sagax_settings,
 * DEVICE_PREFERENCE_KEYS): written here, announced as another tab's write,
 * and on an organization server saved by the watcher like a change by hand. */
export function applyBotPreference(key: string, value: string): void {
  if (typeof window === "undefined" || !DEVICE_PREFERENCE_KEYS.has(key)) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    return;
  }
  announceKey(key);
}

/** A `storage` event for one key on this page, as another tab's write raises it. */
function announceKey(key: string): void {
  try {
    window.dispatchEvent(new StorageEvent("storage", { key, storageArea: window.localStorage }));
  } catch {
    window.dispatchEvent(new StorageEvent("storage", { key }));
  }
}

/** The page's own wiring: real fetch, localStorage, the desktop's hand-over. */
export async function syncUserPreferences(): Promise<void> {
  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    return;
  }
  const takeLocal = window.ogb?.orgJoin?.takePreferences;
  const sync = await startPreferenceSync({
    fetch: window.fetch.bind(window),
    storage,
    takeLocalPreferences: takeLocal ? () => takeLocal() : undefined,
    notify: announceKey,
  });
  if (!sync) return;
  window.addEventListener("pagehide", sync.flush);
  window.addEventListener(PREFERENCES_EVENT, (event) => {
    // this page's own unsaved changes go first, so the frame finds them saved
    void sync.check().then(() => sync.receive((event as CustomEvent).detail));
  });
  let refreshedAt = Date.now();
  window.addEventListener("focus", () => {
    if (Date.now() - refreshedAt < REFRESH_MS) return;
    refreshedAt = Date.now();
    void sync.check().then(() => sync.refresh());
  });
}
