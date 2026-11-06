import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { z } from "zod";
import { writeFileAtomic } from "../atomic.ts";

export const teamComputerCreate = z.object({
  name: z.string().trim().min(1).max(60).refine(value => [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)),
  acknowledgeCost: z.literal(true),
  // Clients may keep this id across a lost create response. It is not a Boat id.
  requestId: z.string().uuid(),
}).strict();
export const teamComputerAssignment = z.object({
  section: z.string().trim().max(60).nullable(),
  acknowledgeSharedAccess: z.literal(true),
}).strict();
const SECTION_ID = /^sec_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const entrySchema = z.object({
  id: z.string().uuid(), name: teamComputerCreate.shape.name,
  section: z.string().trim().max(60).nullable(),
  /** #2045: stable team id when assigned on an organization server. */
  sectionId: z.string().regex(SECTION_ID).nullable().optional(),
  createdAt: z.number().finite().nonnegative(),
  problem: z.string().max(500).optional(),
}).strict();
const fileSchema = z.object({ version: z.literal(1), environmentId: z.string().uuid(), computers: z.array(entrySchema).max(100) }).strict();
export type TeamComputerRecord = z.infer<typeof entrySchema>;
export const teamComputerOwner = (id: string): string => `computer_${id}`;
const failure = (message: string, status = 409) => Object.assign(new Error(message), { status });

/** One server writer owns the data directory. Persist identity before any
 * provider call; failed/retried creates always retain the same Boat journal key.
 * Invalid or foreign restored state is never silently reset to an empty pool. */
export class TeamComputers {
  private entries: TeamComputerRecord[] = [];
  private problem?: string;
  private readonly file: string;
  private readonly environmentId: string;
  constructor(file: string, environmentId: string) {
    this.file = file;
    this.environmentId = environmentId;
    try {
      if (!existsSync(file)) return;
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 100_000) throw new Error("unsafe registry file");
      const saved = fileSchema.parse(JSON.parse(readFileSync(file, "utf8")));
      if (saved.environmentId !== environmentId) throw new Error("registry belongs to another workspace; its computers were not transferred");
      if (new Set(saved.computers.map(entry => entry.id)).size !== saved.computers.length) throw new Error("duplicate computer identity");
      // #2045: uniqueness is per stable section id when stamped; display
      // names alone may collide across people.
      const assigned = saved.computers.filter((entry) => entry.section !== null);
      const byId = assigned.map((entry) => entry.sectionId).filter((id): id is string => Boolean(id));
      if (new Set(byId).size !== byId.length) throw new Error("a team has more than one computer");
      const byName = assigned.filter((entry) => !entry.sectionId).map((entry) => entry.section as string);
      if (new Set(byName).size !== byName.length) throw new Error("a team has more than one computer");
      this.entries = saved.computers;
    } catch (error) {
      this.problem = `Team computer registry could not be loaded: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  list(): TeamComputerRecord[] {
    if (this.problem) throw failure(this.problem, 503);
    return this.entries.map(entry => ({ ...entry }));
  }
  get(id: string): TeamComputerRecord | undefined { return this.list().find(entry => entry.id === id); }
  forSection(section: string | undefined, sectionId?: string | null): TeamComputerRecord | undefined {
    const id = sectionId?.trim();
    if (id) {
      const byId = this.list().find((entry) => entry.sectionId === id);
      if (byId) return byId;
      // Legacy: assignment stamped before sectionId existed.
      const name = section?.trim() || "";
      return this.list().find((entry) => entry.section !== null && entry.section === name && !entry.sectionId);
    }
    const name = section?.trim() || "";
    return this.list().find((entry) => entry.section !== null && entry.section === name);
  }
  forBot(bot: { computer?: string; cloudBackend?: string; section?: string; sectionId?: string }): TeamComputerRecord | undefined {
    // Explicit destinations are permissions, not suggestions. Only Auto inherits.
    return bot.computer === undefined && bot.cloudBackend !== "vps" ? this.forSection(bot.section, bot.sectionId) : undefined;
  }
  create(name: string, id: string = randomUUID()): TeamComputerRecord {
    const entries = this.list();
    const existing = entries.find(entry => entry.id === id);
    if (existing) {
      if (existing.name !== name) throw failure("This creation id already names a different computer");
      return existing;
    }
    if (entries.length >= 100) throw failure("This workspace has reached its team computer limit");
    const entry = entrySchema.parse({ id, name, section: null, sectionId: null, createdAt: Date.now() });
    this.save([...entries, entry]);
    return { ...entry };
  }
  assign(id: string, section: string | null, sectionId?: string | null): TeamComputerRecord {
    section = entrySchema.shape.section.parse(section);
    const nextId = section === null ? null : (sectionId?.trim() && SECTION_ID.test(sectionId.trim()) ? sectionId.trim() : null);
    const entry = this.get(id);
    if (!entry) throw failure("No such team computer", 404);
    if (entry.section !== null && section !== null && entry.section !== section) {
      // Same stable id: only the displayed name is changing.
      if (!(nextId && entry.sectionId === nextId)) {
        throw failure("Unassign this computer before moving it to another team");
      }
    }
    if (section !== null && this.list().some((other) => {
      if (other.id === id) return false;
      if (nextId && other.sectionId === nextId) return true;
      return !nextId && other.section === section;
    })) throw failure("This team already has a computer; unassign it first");
    return this.patch(id, { section, sectionId: nextId });
  }
  setProblem(id: string, problem?: string): TeamComputerRecord {
    return this.patch(id, { problem: problem?.slice(0, 500) });
  }
  /** Relabel an existing team's assignment; this never changes its computer.
   * When `sectionId` is set, the assignment is found by id so another
   * person's same display name is left alone (#2045). */
  renameSection(from: string, to: string, sectionId?: string | null): boolean {
    const entry = this.forSection(from, sectionId);
    if (!entry || from === to) return false;
    const nextId = entry.sectionId ?? (sectionId?.trim() && SECTION_ID.test(sectionId.trim()) ? sectionId.trim() : null);
    const conflict = this.list().some((other) => {
      if (other.id === entry.id || other.section === null) return false;
      if (nextId && other.sectionId === nextId) return true;
      if (nextId && other.sectionId) return false;
      return other.section === to;
    });
    if (conflict) throw failure("This team already has a computer");
    this.patch(entry.id, { section: to, sectionId: nextId });
    return true;
  }
  private patch(id: string, patch: Partial<TeamComputerRecord>): TeamComputerRecord {
    const entries = this.list();
    const entry = entries.find(candidate => candidate.id === id);
    if (!entry) throw failure("No such team computer", 404);
    const next = entrySchema.parse({ ...entry, ...patch });
    this.save(entries.map(candidate => candidate.id === id ? next : candidate));
    return { ...next };
  }
  private save(entries: TeamComputerRecord[]): void {
    writeFileAtomic(this.file, JSON.stringify({ version: 1, environmentId: this.environmentId, computers: entries }), { mode: 0o600 });
    this.entries = entries;
  }
}
