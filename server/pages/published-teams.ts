// What this installation has shared, per team: the package id and the
// release last exported, plus the key each bot, group chat and routine was
// published under.
//
// Keys are a package's identity across releases (Admin refuses a release
// that silently drops one, and later updates match on them). They must not
// come from names once they exist: renaming a bot, a room, a routine or the
// team would otherwise read as "everything removed, everything added". So
// the first export records them here, keyed by record id, and every later
// export of the same team reuses them.
//
// #2045: team entries are keyed by stable section id (`sec_<uuid>`) when
// known. Legacy name keys still read until migratePublishedTeamKeys (boot)
// or the next write/rename moves them. section-context.ts still calls
// renamePublishedTeam on the legacy empty-name path; org renames also call
// it with the section id.
//
// Server-private: nothing here is on the wire, and nothing here is a secret.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";
import { DATA_DIR } from "../config.ts";
import { isSectionId } from "../rooms/section-link.ts";

export const PUBLISHED_TEAMS_FILE = join(DATA_DIR, "published-teams.json");

const keyMap = z.record(z.string(), z.string());
const publishedTeamSchema = z.object({
  packageId: z.string().min(1),
  lastRelease: z.string().min(1),
  keys: z.object({ bots: keyMap, rooms: keyMap, routines: keyMap }).default({ bots: {}, rooms: {}, routines: {} }),
});
const fileSchema = z.object({ version: z.literal(1), teams: z.record(z.string(), z.unknown()) });

export type PublishedTeam = z.output<typeof publishedTeamSchema>;

function load(): Map<string, PublishedTeam> {
  const teams = new Map<string, PublishedTeam>();
  if (!existsSync(PUBLISHED_TEAMS_FILE)) return teams;
  try {
    const file = fileSchema.parse(JSON.parse(readFileSync(PUBLISHED_TEAMS_FILE, "utf8")));
    // Own entries only: a team may be called anything, including __proto__.
    for (const [section, value] of Object.entries(file.teams)) {
      const entry = publishedTeamSchema.safeParse(value);
      if (entry.success) teams.set(section, entry.data);
    }
  } catch {
    // An unreadable record only costs key stability on the next export,
    // which then derives keys from names as a first export does.
  }
  return teams;
}

function save(teams: Map<string, PublishedTeam>): void {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const out: Record<string, PublishedTeam> = Object.create(null);
  for (const [section, entry] of teams) out[section] = entry;
  writeFileAtomic(PUBLISHED_TEAMS_FILE, JSON.stringify({ version: 1, teams: out }, null, 2), { mode: 0o600 });
}

/** #2045: move unambiguous display-name keys onto section ids in memory.
 * A name held by more than one owner (resolve returns null) stays put.
 * When the id key already exists, the leftover name key is dropped. */
export function migratePublishedTeamEntries(
  teams: Map<string, PublishedTeam>,
  resolve: (name: string) => string | null,
): { next: Map<string, PublishedTeam>; moved: number } {
  const next = new Map(teams);
  let moved = 0;
  for (const [key, entry] of teams) {
    if (isSectionId(key)) continue;
    const name = key.trim();
    if (!name) continue;
    const id = resolve(name)?.trim();
    if (!id || !isSectionId(id)) continue;
    next.delete(key);
    if (!next.has(id)) next.set(id, entry);
    moved += 1;
  }
  return { next, moved };
}

/** Boot: rewrite leftover name keys when exactly one section channel owns
 * that display name. Returns how many keys moved or were dropped. */
export function migratePublishedTeamKeys(
  resolve: (name: string) => string | null,
): number {
  const loaded = load();
  if (!loaded.size) return 0;
  const { next, moved } = migratePublishedTeamEntries(loaded, resolve);
  if (moved) save(next);
  return moved;
}

/** Prefer a stable section id; fall back to a legacy display-name key. */
export function readPublishedTeam(section: string, sectionId?: string | null): PublishedTeam | null {
  const teams = load();
  const id = sectionId?.trim();
  if (id && isSectionId(id)) {
    const byId = teams.get(id);
    if (byId) return byId;
  }
  return teams.get(section) ?? null;
}

export function writePublishedTeam(section: string, entry: PublishedTeam, sectionId?: string | null): void {
  const teams = load();
  const id = sectionId?.trim();
  const key = id && isSectionId(id) ? id : section;
  teams.set(key, entry);
  // Drop a leftover name key once the record lives under the id.
  if (key !== section && teams.has(section)) teams.delete(section);
  save(teams);
}

/** Follow a team rename; null forgets the team (it was deleted).
 * When `sectionId` is set, the record is found/stored under that id so
 * another person's same display name is left alone (#2045). */
export function renamePublishedTeam(
  name: string,
  nextName: string | null,
  sectionId?: string | null,
): void {
  const teams = load();
  const id = sectionId?.trim();
  const fromKey = id && isSectionId(id) && teams.has(id) ? id : name;
  const entry = teams.get(fromKey) ?? (id && isSectionId(id) ? teams.get(name) : undefined);
  if (!entry || (nextName !== null && name === nextName && fromKey === (id && isSectionId(id) ? id : name))) {
    // Still migrate a name-keyed record onto the id when the label is unchanged.
    if (entry && id && isSectionId(id) && fromKey === name && teams.has(name)) {
      teams.delete(name);
      teams.set(id, entry);
      save(teams);
    }
    return;
  }
  teams.delete(fromKey);
  if (fromKey !== name) teams.delete(name);
  if (nextName !== null) {
    const toKey = id && isSectionId(id) ? id : nextName;
    teams.set(toKey, entry);
    if (toKey !== nextName) teams.delete(nextName);
  }
  save(teams);
}

/** "1.2.3" → "1.2.4"; nothing published yet (or unreadable) starts at 1.0.0. */
export function nextPatchRelease(release: string | undefined): string {
  const match = release?.match(/^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/);
  if (!match) return "1.0.0";
  const [major, minor, patch] = match.slice(1).map(Number) as [number, number, number];
  return patch < 999_999 ? `${major}.${minor}.${patch + 1}` : `${major}.${minor + 1}.0`;
}
