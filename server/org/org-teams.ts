// The names of the Perspicax teams (slice 4). Pulsa Bot never edits a team:
// who is in one lives on each principal (principals.ts `teams`), and this
// small registry only remembers each team's display name, from the
// directory (authoritative, replaces the list) and from sign-in claims
// (merged, so a team seen in an id_token before the first directory answer
// still has a name).
//
// File: org-teams.json, { version: 1, teams: [{ id, name }] }, written
// atomically with mode 0600.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";
import { TEAM_ID_REGEX } from "../principals.ts";

export const MAX_ORG_TEAMS = 100_000;
const teamSchema = z.object({ id: z.string().regex(TEAM_ID_REGEX), name: z.string().max(200) });
const fileSchema = z.object({ version: z.literal(1), teams: z.array(z.unknown()).max(MAX_ORG_TEAMS) });

export interface OrgTeam {
  id: string;
  name: string;
}

function cleanTeams(entries: readonly unknown[]): OrgTeam[] {
  const byId = new Map<string, string>();
  for (const entry of entries) {
    const parsed = teamSchema.safeParse(entry);
    if (!parsed.success) continue;
    byId.set(parsed.data.id, parsed.data.name.trim().slice(0, 200));
  }
  return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export class OrgTeams {
  private readonly path: string;
  private teams: OrgTeam[] = [];

  constructor(options: { path: string }) {
    this.path = options.path;
    if (!existsSync(this.path)) return;
    try {
      const parsed = fileSchema.safeParse(JSON.parse(readFileSync(this.path, "utf8")));
      if (parsed.success) this.teams = cleanTeams(parsed.data.teams);
      else console.error(`org-teams: ${this.path} is not a version 1 file; starting with no team names`);
    } catch (error) {
      console.error(`org-teams: ${this.path} is unreadable (${error instanceof Error ? error.message : String(error)}); starting with no team names`);
    }
  }

  list(): OrgTeam[] {
    return this.teams.map((team) => ({ ...team }));
  }

  has(id: string): boolean {
    return this.teams.some((team) => team.id === id);
  }

  name(id: string): string | undefined {
    return this.teams.find((team) => team.id === id)?.name;
  }

  /** The directory is the whole list: teams it no longer names are gone.
   * Returns true when something changed. */
  replaceFromDirectory(teams: readonly { id: string; name: string }[]): boolean {
    return this.save(cleanTeams(teams));
  }

  /** A sign-in's claims name some teams: add or rename them, keep the rest. */
  mergeFromClaims(teams: readonly { id: string; name: string }[]): boolean {
    if (!teams.length) return false;
    const byId = new Map(this.teams.map((team) => [team.id, team.name] as const));
    for (const team of cleanTeams(teams)) byId.set(team.id, team.name);
    return this.save(cleanTeams([...byId].map(([id, name]) => ({ id, name }))));
  }

  private save(next: OrgTeam[]): boolean {
    if (JSON.stringify(next) === JSON.stringify(this.teams)) return false;
    this.teams = next;
    try {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      writeFileAtomic(this.path, JSON.stringify({ version: 1, teams: next }, null, 2), { mode: 0o600 });
    } catch (error) {
      console.error(`org-teams: could not save ${this.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return true;
  }
}
