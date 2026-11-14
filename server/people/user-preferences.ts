// A person's preferences on an organization server (shared/user-preferences.ts):
// kept per person (principal id), so the appearance, language, notifications
// and mascot settings a person chose follow them to every device they sign
// in on. One small JSON file in the data directory, written atomically.
//
// Routes (server/index.ts): GET and PUT /api/me/preferences, a signed-in
// person's own record only (the session's principal), on an organization
// server only. Nobody reads or writes another person's preferences, an
// admin included.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { cleanUserPreferences, isUserPreferenceKey, type UserPreferences } from "../../shared/user-preferences.ts";
import { writeFileAtomic } from "../atomic.ts";

// The one-time move to Advanced (src/lib/interface-mode.ts, 2026-10-16).
const INTERFACE_MODE_KEY = "sagax.interfaceMode.v1";
const MIGRATION_KEY = "sagax.advancedModeMigratedAt.v1";

/**
 * Once per person: a record without the marker has a stored Simple turned
 * into Advanced, and gets the marker. A record with the marker is left as
 * it is, so Simple chosen afterwards stays. Returns the record to keep, or
 * null when nothing changed.
 */
export function migrateToAdvancedOnce(preferences: UserPreferences, at: string): UserPreferences | null {
  if (preferences[MIGRATION_KEY]) return null;
  const next: UserPreferences = { ...preferences, [MIGRATION_KEY]: at };
  if (next[INTERFACE_MODE_KEY] === "simple") next[INTERFACE_MODE_KEY] = "advanced";
  return next;
}

const PRINCIPAL_ID = /^pr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** More people than an organization server serves; a bound, not a quota. */
export const MAX_PEOPLE = 10_000;

const fileSchema = z.object({
  version: z.literal(1),
  people: z.record(z.string(), z.object({ preferences: z.record(z.string(), z.string()), updatedAt: z.number() })),
});

export interface PersonPreferences {
  /** False until this person saved anything: the desktop then offers the
   * preferences it had on this computer, once. */
  stored: boolean;
  preferences: UserPreferences;
  updatedAt: number | null;
}

export interface UserPreferenceStore {
  /** Read and parse the file now (the server calls it once at start, before
   * it listens), so no person's turn pays the read: the first turn after a
   * start looked a person's language up through this store (#3539). Later
   * calls do nothing. */
  load(): void;
  get(principalId: string): PersonPreferences;
  /** Replace this person's preferences with the known keys of `input`. */
  put(principalId: string, input: unknown): PersonPreferences;
  /** Change only some keys: `set` writes the known keys it carries, `remove`
   * forgets the ones it names; every other key stays as it was. Two devices
   * saving different keys at once both keep their change. */
  merge(principalId: string, set: unknown, remove: unknown): PersonPreferences;
  /** Forget this person's preferences (account deletion). */
  remove(principalId: string): void;
}

export function createUserPreferenceStore(dataDir: string, now: () => number = Date.now): UserPreferenceStore {
  const file = join(dataDir, "user-preferences.json");
  let people: Record<string, { preferences: UserPreferences; updatedAt: number }> | null = null;

  const load = () => {
    if (people) return people;
    people = {};
    if (!existsSync(file)) return people;
    try {
      const parsed = fileSchema.parse(JSON.parse(readFileSync(file, "utf8")));
      let migrated = false;
      const at = new Date(now()).toISOString();
      for (const [id, entry] of Object.entries(parsed.people)) {
        if (!PRINCIPAL_ID.test(id)) continue;
        const preferences = cleanUserPreferences(entry.preferences);
        const moved = migrateToAdvancedOnce(preferences, at);
        if (moved) migrated = true;
        people[id] = { preferences: moved ?? preferences, updatedAt: moved ? now() : entry.updatedAt };
      }
      // Written once, the first time this version reads the file: the markers
      // keep every later start (and every device) from moving anyone again.
      if (migrated) {
        try {
          writeFileAtomic(file, `${JSON.stringify({ version: 1, people }, null, 2)}\n`, { mode: 0o600 });
        } catch (error) {
          // The move holds in memory; the next save writes it.
          console.warn(`user preferences: ${file} could not be written after the move to Advanced (${error instanceof Error ? error.message : String(error)})`);
        }
      }
    } catch (error) {
      // A damaged file costs people their synced choices, never the server.
      console.warn(`user preferences: ${file} could not be read (${error instanceof Error ? error.message : String(error)}); starting empty`);
    }
    return people;
  };

  const requirePerson = (principalId: string) => {
    if (!PRINCIPAL_ID.test(principalId)) throw Object.assign(new Error("not a person"), { status: 403 });
  };

  const save = (principalId: string, preferences: UserPreferences): PersonPreferences => {
    requirePerson(principalId);
    const all = load();
    if (!all[principalId] && Object.keys(all).length >= MAX_PEOPLE) throw Object.assign(new Error("too many people"), { status: 507 });
    // The marker is never dropped: a client that does not know it (a PUT of
    // the whole record, a remove) cannot make the move run again.
    const marker = all[principalId]?.preferences[MIGRATION_KEY];
    if (marker && !preferences[MIGRATION_KEY]) preferences = { ...preferences, [MIGRATION_KEY]: marker };
    const entry = { preferences, updatedAt: now() };
    all[principalId] = entry;
    writeFileAtomic(file, `${JSON.stringify({ version: 1, people: all }, null, 2)}\n`, { mode: 0o600 });
    return { stored: true, preferences: { ...entry.preferences }, updatedAt: entry.updatedAt };
  };

  return {
    load() {
      load();
    },
    get(principalId) {
      requirePerson(principalId);
      const entry = load()[principalId];
      return entry ? { stored: true, preferences: { ...entry.preferences }, updatedAt: entry.updatedAt } : { stored: false, preferences: {}, updatedAt: null };
    },
    put(principalId, input) {
      return save(principalId, cleanUserPreferences(input));
    },
    merge(principalId, set, remove) {
      requirePerson(principalId);
      const next: UserPreferences = { ...load()[principalId]?.preferences };
      if (Array.isArray(remove)) for (const key of remove) if (isUserPreferenceKey(key)) delete next[key];
      Object.assign(next, cleanUserPreferences(set));
      return save(principalId, next);
    },
    remove(principalId) {
      const all = load();
      if (!all[principalId]) return;
      delete all[principalId];
      writeFileAtomic(file, `${JSON.stringify({ version: 1, people: all }, null, 2)}\n`, { mode: 0o600 });
    },
  };
}

/**
 * The live frame a save sends (`{ kind: "preferences", audience, preferences,
 * updatedAt }`): it reaches the streams of the person it belongs to and no
 * one else's, so their other devices apply the change within seconds.
 */
export function preferencesFrameAllowed(payload: { kind?: unknown; audience?: unknown }, viewerId: string | undefined): boolean {
  if (payload.kind !== "preferences") return true;
  return typeof payload.audience === "string" && Boolean(viewerId) && payload.audience === viewerId;
}
