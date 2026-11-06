// Enrolled unattended hosts placed on a team from the Computers panel
// (2026-11-06). A host dropped on a team is reachable by every bot of that
// team that belongs to the person who placed it (person isolation): the
// bots inherit it next to the hosts attached in their own Computer tab.
// One file per server, written atomically; host ids stay opaque.
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { z } from "zod";
import { writeFileAtomic } from "../atomic.ts";
import { UNATTENDED_HOST_ID } from "../../shared/remote-unattended-host.ts";

const SECTION_ID = /^sec_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const entrySchema = z.object({
  hostId: z.string().regex(UNATTENDED_HOST_ID),
  principalId: z.string().trim().min(1).max(200),
  section: z.string().trim().max(60),
  sectionId: z.string().regex(SECTION_ID).nullable().optional(),
  assignedAt: z.number().finite().nonnegative(),
}).strict();
const fileSchema = z.object({ version: z.literal(1), hosts: z.array(entrySchema).max(2_000) }).strict();
export type RemoteHostTeam = z.infer<typeof entrySchema>;

const person = (id: string) => id.trim().toLowerCase();

export class RemoteHostTeams {
  private entries: RemoteHostTeam[] = [];
  private readonly file: string;
  private readonly now: () => number;
  constructor(file: string, now: () => number = Date.now) {
    this.file = file;
    this.now = now;
    try {
      if (!existsSync(file)) return;
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1_000_000) return;
      this.entries = fileSchema.parse(JSON.parse(readFileSync(file, "utf8"))).hosts;
    } catch {
      // A damaged file reads as no placement: the hosts stay attached per bot.
      this.entries = [];
    }
  }

  /** This person's placements, by host id. */
  forPrincipal(principalId: string): Map<string, RemoteHostTeam> {
    const who = person(principalId);
    return new Map(this.entries.filter((entry) => person(entry.principalId) === who).map((entry) => [entry.hostId, { ...entry }]));
  }

  /** Place a host on a team (or take it off with section null). */
  assign(principalId: string, hostId: string, section: string | null, sectionId?: string | null): RemoteHostTeam | null {
    const who = person(principalId);
    const rest = this.entries.filter((entry) => !(entry.hostId === hostId && person(entry.principalId) === who));
    if (section === null || !section.trim()) {
      this.entries = rest;
      this.save();
      return null;
    }
    const entry = entrySchema.parse({
      hostId,
      principalId: who,
      section: section.trim(),
      sectionId: sectionId?.trim() && SECTION_ID.test(sectionId.trim()) ? sectionId.trim() : null,
      assignedAt: this.now(),
    });
    this.entries = [...rest, entry];
    this.save();
    return { ...entry };
  }

  /** Host ids a bot inherits from its team: placed by the bot's owner on the
   * bot's team (by stable id when both have one, else by team name). */
  forBot(bot: { section?: string; sectionId?: string }, ownerPrincipalId: string, sectionKey: (section?: string) => string): string[] {
    const who = person(ownerPrincipalId);
    if (!who) return [];
    const name = sectionKey(bot.section);
    return this.entries
      .filter((entry) => person(entry.principalId) === who)
      .filter((entry) => entry.sectionId && bot.sectionId ? entry.sectionId === bot.sectionId : entry.section === name)
      .map((entry) => entry.hostId);
  }

  /** Follow a team rename. */
  renameSection(from: string, to: string): void {
    let changed = false;
    this.entries = this.entries.map((entry) => {
      if (entry.section !== from) return entry;
      changed = true;
      return { ...entry, section: to.trim().slice(0, 60) };
    });
    if (changed) this.save();
  }

  private save(): void {
    writeFileAtomic(this.file, JSON.stringify({ version: 1, hosts: this.entries }, null, 2));
  }
}
