// A personal computer's look for its paired phone (shared/desktop-appearance.ts):
// the desktop's skin, font and Hibou 98 switch, one small JSON file in the
// data directory, written atomically. Organization servers keep the same keys
// per person in server/user-preferences.ts instead.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanDesktopAppearance, type DesktopAppearance } from "../../shared/desktop-appearance.ts";
import { writeFileAtomic } from "../atomic.ts";

export interface DesktopAppearanceRecord {
  /** False until the desktop (or the phone) saved anything. */
  stored: boolean;
  preferences: DesktopAppearance;
  updatedAt: number | null;
}

export interface DesktopAppearanceStore {
  get(): DesktopAppearanceRecord;
  /** Replace the record with the valid keys of `input`. */
  put(input: unknown): DesktopAppearanceRecord;
}

export function createDesktopAppearanceStore(dataDir: string, now: () => number = Date.now): DesktopAppearanceStore {
  const file = join(dataDir, "desktop-appearance.json");
  let record: DesktopAppearanceRecord | null = null;

  const load = (): DesktopAppearanceRecord => {
    if (record) return record;
    record = { stored: false, preferences: {}, updatedAt: null };
    if (!existsSync(file)) return record;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { preferences?: unknown; updatedAt?: unknown };
      record = {
        stored: true,
        preferences: cleanDesktopAppearance(parsed.preferences),
        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : null,
      };
    } catch (error) {
      // A damaged file costs the phone the desktop's look, never the server.
      console.warn(`desktop appearance: ${file} could not be read (${error instanceof Error ? error.message : String(error)}); starting empty`);
    }
    return record;
  };

  return {
    get() {
      const current = load();
      return { ...current, preferences: { ...current.preferences } };
    },
    put(input) {
      const next: DesktopAppearanceRecord = { stored: true, preferences: cleanDesktopAppearance(input), updatedAt: now() };
      writeFileAtomic(file, `${JSON.stringify({ version: 1, preferences: next.preferences, updatedAt: next.updatedAt }, null, 2)}\n`, { mode: 0o600 });
      record = next;
      return { ...next, preferences: { ...next.preferences } };
    },
  };
}
