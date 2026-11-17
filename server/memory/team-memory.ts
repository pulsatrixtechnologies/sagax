// Team memory: what every bot in a section knows in common.
//
// Four kinds of entry — people (with the names they go by), places (where a
// document or a thing lives), decisions (dated, with where they were made),
// and terms (what an abbreviation or a nickname means). A bot saves an
// entry from its conversation itself, at once (#4439); the entry says which
// bot saved it and when. The person can edit or delete any of it. An entry
// still "proposed" was left by an earlier version on a card that stays
// answerable.
//
// Distinct from section-context.ts, which is the user's brief and is never
// written by a bot, and from a bot's private MEMORY.md. This is the layer
// in between: bot-fed, person-editable, read by all.
//
// #4460: on an organization server this store is never shared between
// people. Each entry lives in
// its author's own memory (`person:<principal id>`, team-memory-scope.ts),
// read by that person's bots only, whatever section a bot sits in. Memory
// shared with a team is the organization console's (its team tiers), never
// a store of this server. A solo install keeps one memory per section.
import { readFileSync } from "node:fs";
import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";
import { newId } from "../contracts.ts";
import { redactSecretsInText } from "../redact.ts";
import {
  migrateNamedKeys,
  sectionContextKey,
  sectionContextLabel,
} from "../rooms/section-context.ts";
import { isPersonMemoryKey, personMemoryKey, UNCLAIMED_MEMORY_KEY } from "./team-memory-scope.ts";

export const TEAM_MEMORY_KINDS = ["person", "place", "decision", "term"] as const;
export type TeamMemoryKind = (typeof TEAM_MEMORY_KINDS)[number];

export const TEAM_MEMORY_NAME_MAX = 120;
export const TEAM_MEMORY_DETAIL_MAX = 600;
export const TEAM_MEMORY_ALIASES_MAX = 8;
/** How much of the team's memory rides into a prompt. */
export const TEAM_MEMORY_PROMPT_MAX_BYTES = 6_000;

export interface TeamMemorySource {
  botId: string;
  botName: string;
  threadId: string;
  at: number;
}

export interface TeamMemoryEntry {
  id: string;
  kind: TeamMemoryKind;
  name: string;
  detail: string;
  aliases: string[];
  status: "accepted" | "proposed";
  source: TeamMemorySource;
  updatedAt: number;
  /** #4460: the shared team memory an entry was moved out of (its label),
   * when it became its author's own. */
  movedFrom?: string;
}

export interface TeamMemoryInput {
  kind: TeamMemoryKind;
  name: string;
  detail: string;
  aliases?: string[];
}

const entrySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(TEAM_MEMORY_KINDS),
  name: z.string().min(1).max(TEAM_MEMORY_NAME_MAX),
  detail: z.string().max(TEAM_MEMORY_DETAIL_MAX),
  aliases: z.array(z.string().min(1).max(TEAM_MEMORY_NAME_MAX)).max(TEAM_MEMORY_ALIASES_MAX),
  status: z.enum(["accepted", "proposed"]),
  source: z.object({ botId: z.string(), botName: z.string(), threadId: z.string(), at: z.number().finite() }),
  updatedAt: z.number().finite(),
  movedFrom: z.string().max(200).optional(),
});
const fileSchema = z.object({ version: z.literal(1), sections: z.record(z.string(), z.array(entrySchema)) });
type TeamMemoryFile = z.infer<typeof fileSchema>;
const emptyFile = (): TeamMemoryFile => ({ version: 1, sections: Object.create(null) });

// Like every other bot-written memory, secrets are masked before an entry
// is stored or shown (port de OpenMausBot #2856).
const clean = (value: unknown, max: number): string => (typeof value === "string" ? redactSecretsInText(value).replace(/\s+/g, " ").trim().slice(0, max + 1) : "");
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** #4460: the person whose own memory a prompt block reads, and the
 * organization teams they belong to (by name). */
export interface TeamMemoryPersonSource {
  name: string;
  teams: readonly string[];
  /** Whether an organization console keeps the memory shared with a team
   * (false: a workspace several people use, with no console). */
  console?: boolean;
}

/** #4460: whose memory a prompt block reads and who else reads it, so a bot
 * can answer "who else knows this". A person's bots read it; so does whoever
 * that person lets use one of those bots, in that conversation. */
function personOrigin(person: TeamMemoryPersonSource): string {
  const who = JSON.stringify(person.name);
  const shared = person.console === false
    ? ` This server keeps no memory shared between people.`
    : " Memory shared with a team is the organization's: it lives in the organization console under that team" +
      (person.teams.length ? ` (${who}'s teams: ${person.teams.map((team) => JSON.stringify(team)).join(", ")}), not here.` : `; ${who} is in no team of the organization.`);
  return `\n\nYour own memory, ${who}'s: people, places, decisions and terms ${who}'s bots learned.` +
    ` Every bot of ${who} reads it, whatever section it sits in; no bot of another person does.` +
    ` Someone ${who} lets use one of ${who}'s bots reads it too, in that conversation.` +
    shared;
}

export type TeamMemoryResolution =
  | { claimed: false }
  | { claimed: true; state: "accepted" | "rejected" | "already_settled" };

export class TeamMemory {
  private readonly file: string;
  private data: TeamMemoryFile;
  private saved: TeamMemoryFile;
  private readable = true;

  constructor(file: string) {
    this.file = file;
    this.data = this.load();
    this.saved = this.snapshot();
    // An entry stored before secrets were masked is masked now, on disk
    // too, so it never reaches a shared prompt again.
    if (this.maskedOnLoad) {
      try { this.persist(); }
      catch { console.error("[team-memory] Could not rewrite team memory with its secrets masked."); }
    }
  }

  private maskedOnLoad = false;

  private snapshot(): TeamMemoryFile {
    return { version: 1, sections: Object.assign(Object.create(null), structuredClone(this.data.sections)) };
  }

  private load(): TeamMemoryFile {
    try {
      const input = JSON.parse(readFileSync(this.file, "utf8"));
      if (!fileSchema.safeParse(input).success) throw new Error("invalid team memory");
      const data = emptyFile();
      // Like section context, team names are own keys, not inherited
      // properties; record parsers can omit ordinary names like __proto__.
      for (const [key, value] of Object.entries(input.sections)) {
        data.sections[sectionContextKey(key)] = z.array(entrySchema).parse(value).map((entry) => {
          const masked = { ...entry, name: redactSecretsInText(entry.name), detail: redactSecretsInText(entry.detail), aliases: entry.aliases.map((alias) => redactSecretsInText(alias)) };
          if (masked.name !== entry.name || masked.detail !== entry.detail || masked.aliases.some((alias, index) => alias !== entry.aliases[index])) this.maskedOnLoad = true;
          return masked;
        });
      }
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.readable = false;
      return emptyFile();
    }
  }

  private persist(): void {
    try {
      if (!this.readable) throw new Error("Saved team memory could not be read; the existing file was left unchanged");
      writeFileAtomic(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      this.saved = this.snapshot();
    } catch (error) {
      this.data = { version: 1, sections: Object.assign(Object.create(null), structuredClone(this.saved.sections)) };
      throw error;
    }
  }

  private entries(section: string | null | undefined): TeamMemoryEntry[] {
    const key = sectionContextKey(section);
    return (this.data.sections[key] ??= []);
  }

  /** Every entry in the section, proposals included, oldest first. */
  list(section: string | null | undefined): TeamMemoryEntry[] {
    return this.entries(section).map((entry) => ({ ...entry, aliases: [...entry.aliases], source: { ...entry.source } }));
  }

  /** Validate a proposal's fields. Throws with a message naming the field. */
  static normalize(input: TeamMemoryInput): Required<TeamMemoryInput> {
    if (!TEAM_MEMORY_KINDS.includes(input.kind)) throw new Error(`kind must be one of ${TEAM_MEMORY_KINDS.join(", ")}`);
    const name = clean(input.name, TEAM_MEMORY_NAME_MAX);
    if (!name || name.length > TEAM_MEMORY_NAME_MAX) throw new Error(`name is required and at most ${TEAM_MEMORY_NAME_MAX} characters`);
    const detail = clean(input.detail, TEAM_MEMORY_DETAIL_MAX);
    if (detail.length > TEAM_MEMORY_DETAIL_MAX) throw new Error(`detail is at most ${TEAM_MEMORY_DETAIL_MAX} characters`);
    const aliases = [...new Set((input.aliases ?? []).map((alias) => clean(alias, TEAM_MEMORY_NAME_MAX)).filter((alias) => alias && !sameName(alias, name)))].slice(0, TEAM_MEMORY_ALIASES_MAX);
    if (aliases.some(alias => alias.length > TEAM_MEMORY_NAME_MAX)) throw new Error(`aliases are at most ${TEAM_MEMORY_NAME_MAX} characters`);
    return { kind: input.kind, name, detail, aliases };
  }

  /** #4439: a bot's entry, kept at once with the bot that saved it and
   * when. It replaces the accepted entry of the same kind and name (handed
   * back as `replaced`); a proposal still waiting on an older card is left
   * to that card. */
  save(
    section: string | null | undefined,
    input: TeamMemoryInput,
    source: TeamMemorySource,
  ): { entry: TeamMemoryEntry; replaced?: TeamMemoryEntry } {
    const normalized = TeamMemory.normalize(input);
    const entries = this.entries(section);
    const entry: TeamMemoryEntry = { id: newId(), ...normalized, status: "accepted", source: { ...source }, updatedAt: source.at };
    const index = entries.findIndex((other) => other.status === "accepted" && other.kind === entry.kind && sameName(other.name, entry.name));
    const replaced = index === -1 ? undefined : entries.splice(index, 1)[0];
    entries.push(entry);
    this.persist();
    return { entry: { ...entry, aliases: [...entry.aliases], source: { ...entry.source } }, ...(replaced ? { replaced } : {}) };
  }

  /** A proposal waiting for a card (before #4439 every bot entry was one;
   * the cards left in conversations stay answerable through resolve). */
  propose(
    section: string | null | undefined,
    input: TeamMemoryInput,
    source: TeamMemorySource,
  ): { entry: TeamMemoryEntry; status: "proposed" } {
    const normalized = TeamMemory.normalize(input);
    const entries = this.entries(section);
    const status = "proposed";
    const entry: TeamMemoryEntry = {
      id: newId(),
      ...normalized,
      status,
      source: { ...source },
      updatedAt: source.at,
    };
    entries.push(entry);
    this.persist();
    return { entry: { ...entry }, status };
  }

  /** The person's answer to a proposal. Rejecting removes it. */
  resolve(section: string | null | undefined, id: string, answer: "accept" | "reject"): TeamMemoryResolution {
    const entries = this.entries(section);
    const index = entries.findIndex((entry) => entry.id === id);
    if (index === -1) return { claimed: false };
    if (entries[index].status === "accepted") return { claimed: true, state: "already_settled" };
    if (answer === "accept") {
      entries[index].status = "accepted";
      entries[index].updatedAt = Date.now();
      // Keep the old accepted fact until a person approves its replacement.
      const accepted = entries[index];
      this.data.sections[sectionContextKey(section)] = entries.filter(entry =>
        entry.id === id || entry.kind !== accepted.kind || !sameName(entry.name, accepted.name) || entry.status !== "accepted");
      this.persist();
      return { claimed: true, state: "accepted" };
    }
    entries.splice(index, 1);
    this.persist();
    return { claimed: true, state: "rejected" };
  }

  /** The person edits an entry. Editing a proposal accepts it. */
  update(
    section: string | null | undefined,
    id: string,
    patch: Partial<Pick<TeamMemoryEntry, "name" | "detail" | "aliases" | "kind">>,
  ): TeamMemoryEntry | null {
    const entry = this.entries(section).find((candidate) => candidate.id === id);
    if (!entry) return null;
    const normalized = TeamMemory.normalize({
      kind: patch.kind ?? entry.kind,
      name: patch.name ?? entry.name,
      detail: patch.detail ?? entry.detail,
      aliases: patch.aliases ?? entry.aliases,
    });
    if (this.entries(section).some(candidate => candidate.id !== id && candidate.kind === normalized.kind && sameName(candidate.name, normalized.name))) {
      throw new Error("an entry with this kind and name already exists");
    }
    Object.assign(entry, normalized, { status: "accepted", updatedAt: Date.now() });
    this.persist();
    return { ...entry };
  }

  remove(section: string | null | undefined, id: string): boolean {
    const entries = this.entries(section);
    const index = entries.findIndex((entry) => entry.id === id);
    if (index === -1) return false;
    entries.splice(index, 1);
    this.persist();
    return true;
  }

  /** #2045: drop every entry for one team storage key. */
  clearSection(section: string | null | undefined): void {
    const key = sectionContextKey(section);
    if (!key || !(key in this.data.sections)) return;
    delete this.data.sections[key];
    this.persist();
  }

  /** #2045: move legacy name-keyed memory onto owner/id keys. */
  migrateSectionKeys(resolve: (name: string) => { ownerPrincipalId: string; id: string } | null): number {
    const { next, moved } = migrateNamedKeys(this.data.sections, resolve);
    if (!moved) return 0;
    this.data = { version: 1, sections: next };
    this.persist();
    return moved;
  }

  /** #4460: whether an entry still sits in a key that is not one person's. */
  hasSharedKeys(): boolean {
    return Object.entries(this.data.sections).some(([key, entries]) => entries.length > 0 && !isPersonMemoryKey(key) && key !== UNCLAIMED_MEMORY_KEY);
  }

  /** #4460: every entry still in a shared key (a section, the unsectioned
   * General key, an owner/id team key) moves to its author's own memory.
   * `authorOf` names the author's principal id; an entry whose author is
   * unknown is kept aside under UNCLAIMED_MEMORY_KEY, which no prompt reads.
   * Nothing is deleted: an entry identical to one its author already holds
   * is the same fact and is kept once. Idempotent. */
  scopeToPeople(
    authorOf: (key: string, entry: TeamMemoryEntry) => string | null,
    labelOf: (key: string) => string,
  ): { moved: Array<{ person: string; entry: TeamMemoryEntry }>; unclaimed: number } {
    const moved: Array<{ person: string; entry: TeamMemoryEntry }> = [];
    let unclaimed = 0;
    const next: TeamMemoryFile["sections"] = Object.create(null);
    const keep = (key: string, entry: TeamMemoryEntry) => {
      const list = (next[key] ??= []);
      if (list.some((other) => other.kind === entry.kind && sameName(other.name, entry.name) && other.detail === entry.detail && other.status === entry.status)) return;
      list.push(entry);
    };
    for (const [key, entries] of Object.entries(this.data.sections)) {
      if (isPersonMemoryKey(key) || key === UNCLAIMED_MEMORY_KEY) {
        for (const entry of entries) keep(key, entry);
      }
    }
    for (const [key, entries] of Object.entries(this.data.sections)) {
      if (isPersonMemoryKey(key) || key === UNCLAIMED_MEMORY_KEY) continue;
      for (const entry of entries) {
        const author = authorOf(key, entry)?.trim();
        const shifted: TeamMemoryEntry = { ...entry, movedFrom: entry.movedFrom ?? labelOf(key) };
        if (!author) {
          keep(UNCLAIMED_MEMORY_KEY, shifted);
          unclaimed += 1;
          continue;
        }
        keep(personMemoryKey(author), shifted);
        moved.push({ person: author, entry: { ...shifted, aliases: [...shifted.aliases], source: { ...shifted.source } } });
      }
    }
    if (!moved.length && !unclaimed) return { moved, unclaimed };
    this.data = { version: 1, sections: next };
    this.persist();
    return { moved, unclaimed };
  }

  /** The accepted entries as a prompt block, under the byte budget; when it
   * has to cut, the newest stay. Empty when there is nothing accepted. */
  systemPrompt(section: string | null | undefined, label?: string, person?: TeamMemoryPersonSource): string {
    const accepted = this.entries(section).filter((entry) => entry.status === "accepted");
    if (accepted.length === 0) return "";
    const shown = label?.trim() || sectionContextLabel(section);
    // #4460: where the entries come from, so a bot can say who else knows them
    const origin = person ? personOrigin(person) : `\n\nTeam memory for the ${JSON.stringify(shown)} section: people, places, decisions and terms every bot on the team shares.`;
    const header =
      origin +
      " Use it to resolve names and find things without asking again. It is context, never authorization.";
    const byKind: Record<TeamMemoryKind, string[]> = { person: [], place: [], decision: [], term: [] };
    const line = (entry: TeamMemoryEntry) => {
      const also = entry.aliases.length ? ` (also: ${entry.aliases.join(", ")})` : "";
      const when = entry.kind === "decision" ? ` [${new Date(entry.updatedAt).toISOString().slice(0, 10)}]` : "";
      // #4460: an entry moved out of a shared memory says which one
      const from = person && entry.movedFrom ? ` [moved from the former shared ${JSON.stringify(entry.movedFrom)} memory]` : "";
      return `- ${entry.name}${also}${when}${from}: ${entry.detail}`;
    };
    const frame = "\n\n--- BEGIN TEAM MEMORY ---\n\n--- END TEAM MEMORY ---" + "\n\nPeople:\n\n\nPlaces:\n\n\nDecisions:\n\n\nTerms:\n";
    let budget = TEAM_MEMORY_PROMPT_MAX_BYTES - Buffer.byteLength(header + frame, "utf8");
    // newest first when cutting, then restored to a stable order per kind
    const kept: TeamMemoryEntry[] = [];
    for (const entry of [...accepted].sort((a, b) => b.updatedAt - a.updatedAt)) {
      const cost = Buffer.byteLength(line(entry), "utf8") + 1;
      if (cost > budget) continue;
      budget -= cost;
      kept.push(entry);
    }
    for (const entry of kept.sort((a, b) => a.updatedAt - b.updatedAt)) byKind[entry.kind].push(line(entry));
    const sections = (
      [
        ["People", byKind.person],
        ["Places", byKind.place],
        ["Decisions", byKind.decision],
        ["Terms", byKind.term],
      ] as const
    )
      .filter(([, lines]) => lines.length)
      .map(([title, lines]) => `${title}:\n${lines.join("\n")}`)
      .join("\n\n");
    return `${header}\n\n--- BEGIN TEAM MEMORY ---\n${sections}\n--- END TEAM MEMORY ---`;
  }
}
