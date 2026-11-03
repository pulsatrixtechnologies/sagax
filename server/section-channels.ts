// Sidebar sections as channels on an organization server (slice 4, spec
// section 3, "Les sections de la barre latérale sont des canaux").
//
// A section is a channel: an id, a name, an owner, members (people or
// Perspicax teams, `user:<principal id>` / `team:<team id>`, each with a
// channel role: moderator, participant, readonly), a default level on its
// bots (use or run, never more) and its own conversation (a room, created
// when the first member joins). It joins the bots and rooms that carry its
// name (`bot.section`, `group.section`), so a rename or a delete in the store
// keeps this file in step.
//
// Access (server/auth/authz.ts): a member (directly or through a team) gets
// min(defaultLevel, run) on the section's bots, reads its rooms (readonly)
// and posts in them (participant, moderator). Owning a section gives no
// access to bots someone else placed in it, and a section with no member is
// private: it changes nobody's access, exactly as before this slice.
//
// A shared section opens only the bots whose owner consented: the ones the
// section owner owns, and the ones placed through PUT .../bots by someone
// who manages them (The owner, or a manage holder the owner chose), recorded
// with the owner at that time. A bot that sat in a section before this slice
// and belongs to someone else stays closed until its owner places it again.
// Rooms follow the same rule: a shared section opens its own conversation
// (roomId) and the rooms placed in it with consent (placedRooms: created in
// the section by one of its members, or moved there by an organization
// admin or by a moderator who is the room's only person). A room that
// carried the section's name before (a legacy room, a bot-to-bot channel)
// stays with its own people.
// "General" (no section) is personal: never shared, renamed or deleted.
//
// Sections are personal now (2026-10-02: "a section should only be a
// section after all"). The sidebar keeps each person's own sections in
// their preferences (src/lib/personal-sections.ts) and sharing is per bot
// (its grants, the bot panel). This file stays to keep the records already
// on the server intact: nothing here deletes them. At boot,
// sectionShareGrants turns every legacy shared section into equivalent bot
// grants once (botSharesMigratedAt), and bots no longer take access from a
// section. Rooms a shared section opened keep that access, read from the
// record as before (a room has no grant of its own to carry it). Changing a
// section's members or placing bots in it answers 410
// `sections_are_personal`.
//
// File: section-channels.json, { version: 1, sections: [record] }, atomic,
// 0600. Solo mode never reads it.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import {
  canModerateSection,
  parseTarget,
  sectionRole,
  type SectionAccess,
  type SectionMember,
  type SectionRole,
  type TeamRef,
  type Viewer,
} from "./auth/authz.ts";
import type { RequestAuth } from "./auth/request-auth.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

export const MAX_SECTION_MEMBERS = 200;
const SECTION_ID = /^sec_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const memberSchema = z.object({ target: z.string().max(80), role: z.enum(["moderator", "participant", "readonly"]) });
const recordSchema = z.object({
  id: z.string().regex(SECTION_ID),
  name: z.string().min(1).max(60),
  ownerPrincipalId: z.string().min(1).max(64),
  members: z.array(memberSchema).max(MAX_SECTION_MEMBERS),
  defaultLevel: z.enum(["use", "run"]),
  roomId: z.string().max(80).optional(),
  /** Bots placed with their owner's consent (see the header). */
  placedBots: z.array(z.object({ botId: z.string().min(1).max(80), ownerPrincipalId: z.string().min(1).max(64) })).max(2000).optional(),
  /** Rooms placed with consent (see the header). */
  placedRooms: z.array(z.string().min(1).max(80)).max(2000).optional(),
  createdAt: z.number(),
});
const fileSchema = z.object({ version: z.literal(1), sections: z.array(z.unknown()), botSharesMigratedAt: z.number().optional() });

export type SectionRecord = z.infer<typeof recordSchema>;

/** The name "General" in any case: the personal default section. */
export function isGeneralName(name: string): boolean {
  return name.trim().toLowerCase() === "general";
}

/** A section name: 1 to 60 characters, no control characters. */
export function validSectionName(name: unknown): name is string {
  if (typeof name !== "string") return false;
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 60 && ![...trimmed].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}

/** Who owns a section at the first organization boot: the owner of most of
 * its bots; on a tie, the owner of the oldest of the tied owners' bots; with
 * no bot, the first organization admin. */
export function migrationOwner(bots: readonly { ownerPrincipalId: string; createdAt: number }[], firstAdmin: string): string {
  if (!bots.length) return firstAdmin;
  const counts = new Map<string, number>();
  for (const bot of bots) counts.set(bot.ownerPrincipalId, (counts.get(bot.ownerPrincipalId) ?? 0) + 1);
  const top = Math.max(...counts.values());
  const tied = new Set([...counts].filter(([, count]) => count === top).map(([owner]) => owner));
  const oldest = [...bots].filter((bot) => tied.has(bot.ownerPrincipalId)).sort((a, b) => a.createdAt - b.createdAt)[0]!;
  return oldest.ownerPrincipalId;
}

export class SectionChannels {
  private readonly path: string;
  private readonly now: () => number;
  private readonly newId: () => string;
  private records: SectionRecord[] = [];
  private migratedAt: number | undefined;

  constructor(options: { path: string; now?: () => number; newId?: () => string }) {
    this.path = options.path;
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? (() => `sec_${randomUUID()}`);
    if (!existsSync(this.path)) return;
    try {
      const parsed = fileSchema.safeParse(JSON.parse(readFileSync(this.path, "utf8")));
      if (!parsed.success) throw new Error("not a version 1 file");
      this.migratedAt = parsed.data.botSharesMigratedAt;
      const names = new Set<string>();
      for (const entry of parsed.data.sections) {
        const record = recordSchema.safeParse(entry);
        if (!record.success || names.has(record.data.name)) continue;
        names.add(record.data.name);
        this.records.push(record.data);
      }
    } catch (error) {
      console.error(`section-channels: ${this.path} is unreadable (${error instanceof Error ? error.message : String(error)}); starting with no shared sections`);
    }
  }

  list(): SectionRecord[] {
    return this.records.map((record) => structuredClone(record));
  }

  byId(id: string): SectionRecord | null {
    const found = this.records.find((record) => record.id === id);
    return found ? structuredClone(found) : null;
  }

  byName(name: string): SectionRecord | null {
    const found = this.records.find((record) => record.name === name.trim());
    return found ? structuredClone(found) : null;
  }

  /** The access facts of a section by name; null for a private one (no
   * member) or an unknown name. */
  accessFor(name: string): SectionAccess | null {
    const found = this.records.find((record) => record.name === name.trim());
    if (!found || !found.members.length) return null;
    return { ownerPrincipalId: found.ownerPrincipalId, members: found.members.map((member) => ({ ...member })), defaultLevel: found.defaultLevel };
  }

  /** The access facts of a section for one bot: null when the section is
   * private, or when the bot's owner never consented to it (see the header). */
  accessForBot(name: string, bot: { id: string; ownerPrincipalId: string }): SectionAccess | null {
    const found = this.records.find((record) => record.name === name.trim());
    if (!found || !found.members.length) return null;
    const owner = bot.ownerPrincipalId.trim().toLowerCase();
    const consented = found.ownerPrincipalId.trim().toLowerCase() === owner ||
      (found.placedBots ?? []).some((entry) => entry.botId === bot.id && entry.ownerPrincipalId.trim().toLowerCase() === owner);
    return consented ? this.accessFor(name) : null;
  }

  /** The access facts of a section for one room: null when the section is
   * private, or when the room is neither its own conversation nor placed
   * in it with consent (see the header). */
  accessForRoom(name: string, roomId: string): SectionAccess | null {
    const found = this.records.find((record) => record.name === name.trim());
    if (!found || !found.members.length) return null;
    const placed = found.roomId === roomId || (found.placedRooms ?? []).includes(roomId);
    return placed ? this.accessFor(name) : null;
  }

  /** A room placed in a section with consent. */
  recordRoomPlacement(name: string, roomId: string): void {
    const found = this.records.find((record) => record.name === name.trim());
    if (!found || (found.placedRooms ?? []).includes(roomId)) return;
    found.placedRooms = [...(found.placedRooms ?? []), roomId];
    this.save();
  }

  /** Forget a room's placement in a section (moved out). */
  forgetRoomPlacement(name: string, roomId: string): void {
    const found = this.records.find((record) => record.name === name.trim());
    if (!found?.placedRooms?.includes(roomId)) return;
    found.placedRooms = found.placedRooms.filter((id) => id !== roomId);
    this.save();
  }

  /** A bot placed in a section by someone who manages it, for its owner. */
  recordPlacement(name: string, botId: string, ownerPrincipalId: string): void {
    const found = this.records.find((record) => record.name === name.trim());
    if (!found || !ownerPrincipalId) return;
    found.placedBots = [...(found.placedBots ?? []).filter((entry) => entry.botId !== botId), { botId, ownerPrincipalId }];
    this.save();
  }

  /** Forget a bot's placement in a section (taken out, or placed elsewhere). */
  forgetPlacement(name: string, botId: string): void {
    const found = this.records.find((record) => record.name === name.trim());
    if (!found?.placedBots?.some((entry) => entry.botId === botId)) return;
    found.placedBots = found.placedBots.filter((entry) => entry.botId !== botId);
    this.save();
  }

  /** The record behind a name, created (private, no member) when missing. */
  ensure(name: string, ownerPrincipalId: string): SectionRecord {
    const existing = this.byName(name);
    if (existing) return existing;
    const record: SectionRecord = { id: this.newId(), name: name.trim(), ownerPrincipalId, members: [], defaultLevel: "use", createdAt: this.now() };
    this.records.push(record);
    this.save();
    return structuredClone(record);
  }

  /** First organization boot: every section name without a record becomes a
   * private record. Returns how many were created. */
  migrate(names: readonly string[], ownerFor: (name: string) => string): number {
    let created = 0;
    for (const name of names) {
      const key = name.trim();
      if (!key || this.records.some((record) => record.name === key)) continue;
      this.records.push({ id: this.newId(), name: key, ownerPrincipalId: ownerFor(key), members: [], defaultLevel: "use", createdAt: this.now() });
      created += 1;
    }
    if (created) this.save();
    return created;
  }

  rename(name: string, nextName: string): void {
    const found = this.records.find((record) => record.name === name.trim());
    if (!found) return;
    found.name = nextName.trim();
    this.save();
  }

  removeByName(name: string): void {
    const before = this.records.length;
    this.records = this.records.filter((record) => record.name !== name.trim());
    if (this.records.length !== before) this.save();
  }

  /** Forget records whose name the store no longer has. */
  reconcile(names: readonly string[]): void {
    const keep = new Set(names.map((name) => name.trim()));
    const before = this.records.length;
    this.records = this.records.filter((record) => keep.has(record.name));
    if (this.records.length !== before) this.save();
  }

  setMembers(id: string, members: SectionMember[], defaultLevel: "use" | "run"): SectionRecord | null {
    const found = this.records.find((record) => record.id === id);
    if (!found) return null;
    found.members = members.map((member) => ({ ...member }));
    found.defaultLevel = defaultLevel;
    this.save();
    return structuredClone(found);
  }

  /** Slice 8: the people of a section after an interim attach (owner,
   * members, placements); the name and the room stay. Null for an unknown id. */
  setPeople(id: string, people: Pick<SectionRecord, "ownerPrincipalId" | "members" | "placedBots">): SectionRecord | null {
    const found = this.records.find((record) => record.id === id);
    if (!found) return null;
    found.ownerPrincipalId = people.ownerPrincipalId;
    found.members = people.members.map((member) => ({ ...member }));
    if (people.placedBots) found.placedBots = people.placedBots.map((entry) => ({ ...entry }));
    this.save();
    return structuredClone(found);
  }

  setRoom(id: string, roomId: string): void {
    const found = this.records.find((record) => record.id === id);
    if (!found) return;
    found.roomId = roomId;
    this.save();
  }

  /** Whether the legacy shared sections already became bot grants. */
  botSharesMigrated(): boolean {
    return this.migratedAt !== undefined;
  }

  /** Record that the legacy shares became bot grants (never twice: an owner
   * who later removes such a grant keeps it removed). */
  markBotSharesMigrated(): void {
    this.migratedAt = this.now();
    this.save();
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      const file = { version: 1, sections: this.records, ...(this.migratedAt !== undefined ? { botSharesMigratedAt: this.migratedAt } : {}) };
      writeFileAtomic(this.path, JSON.stringify(file, null, 2), { mode: 0o600 });
    } catch (error) {
      console.error(`section-channels: could not save ${this.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** One bot grant a legacy shared section stands for. */
export interface SectionShareGrant {
  botId: string;
  target: string;
  level: "use" | "run";
  /** Who shared the section (recorded as the grant's giver). */
  by: string;
  section: string;
}

/** Sections are personal: the bot grants that carry what each legacy shared
 * section opened (its members, at its default level capped at run, on the
 * bots whose owner consented, see accessForBot). Rooms are not here: they
 * keep reading the record. */
export function sectionShareGrants(channels: SectionChannels, bots: readonly { id: string; section?: string | undefined; ownerPrincipalId: string }[]): SectionShareGrant[] {
  const out: SectionShareGrant[] = [];
  for (const bot of bots) {
    const name = bot.section?.trim();
    if (!name) continue;
    const access = channels.accessForBot(name, { id: bot.id, ownerPrincipalId: bot.ownerPrincipalId });
    if (!access) continue;
    for (const member of access.members) {
      if (!parseTarget(member.target)) continue;
      out.push({ botId: bot.id, target: member.target, level: access.defaultLevel === "run" ? "run" : "use", by: access.ownerPrincipalId ?? bot.ownerPrincipalId, section: name });
    }
  }
  return out;
}

/** The access facts of a record, members or not (for the rules that judge
 * who may change it). */
export function recordAccess(record: SectionRecord): SectionAccess {
  return { ownerPrincipalId: record.ownerPrincipalId, members: record.members.map((member) => ({ ...member })), defaultLevel: record.defaultLevel };
}

export interface SectionRouteDeps {
  channels: SectionChannels;
  viewer(auth: RequestAuth): Viewer | undefined;
  /** The caller's principal id (the operator's when loopback). */
  principalId(auth: RequestAuth): string;
  teamsOf(principalId: string): readonly TeamRef[];
  /** The store's section names. */
  sections(): string[];
  /** Create an empty section; an error text, or undefined. */
  createSection(name: string): string | undefined;
  renameSection(name: string, nextName: string): string | undefined;
  deleteSection(name: string): string | undefined;
  /** Something about who sees what changed. */
  onChanged(): void;
  /** Slice 7: one audit row per saved change (category section). */
  audit?(auth: RequestAuth, row: SectionAuditRow): void;
}

/** A section change for the admin activity log (slice 7). */
export interface SectionAuditRow {
  action: "section.create" | "section.rename" | "section.delete" | "section.member.set" | "section.member.remove" | "section.default_level" | "section.bot.place" | "section.bot.remove";
  section: { id: string; name: string };
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

type WireSection = SectionRecord & { viewerRole: SectionRole | "owner" | null; canModerate: boolean };

/** What the section list shows a viewer: owner, member (directly or by team),
 * moderator by admin right, or a manager whose teams an entry reaches. */
export function sectionForViewer(viewer: Viewer | undefined, record: SectionRecord, teamsOf: (principalId: string) => readonly TeamRef[]): WireSection | null {
  const access = recordAccess(record);
  if (!viewer) return { ...record, viewerRole: "owner", canModerate: true };
  const role = viewer.disabled ? null : sectionRole(viewer, access);
  const moderate = canModerateSection(viewer, access);
  const managerReach = !viewer.disabled && record.members.some((member) => {
    const parsed = parseTarget(member.target);
    const managed = new Set(viewer.teams.filter((team) => team.manager).map((team) => team.id));
    if (!parsed || !managed.size) return false;
    return parsed.kind === "team" ? managed.has(parsed.id) : teamsOf(parsed.id).some((team) => managed.has(team.id));
  });
  if (!role && !moderate && !managerReach) return null;
  return { ...record, viewerRole: role, canModerate: moderate };
}

const GENERAL = { error: "General is personal: it can't be shared, renamed or deleted.", code: "general_is_personal" } as const;
const PERSONAL = { error: "Sections are personal: share a bot from its own panel.", code: "sections_are_personal" } as const;
const NOT_ALLOWED = { error: "you may not change this section", code: "not_allowed" } as const;

export function createSectionChannelRoutes(deps: SectionRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/org/sections" && !path.startsWith("/api/org/sections/")) return PASS;
    res.setHeader("cache-control", "no-store");
    const viewer = deps.viewer(auth);

    if (path === "/api/org/sections" && method === "GET") {
      const sections = deps.channels.list().flatMap((record) => {
        const shown = sectionForViewer(viewer, record, deps.teamsOf);
        return shown ? [shown] : [];
      });
      return json(res, 200, { sections });
    }
    if (path === "/api/org/sections" && method === "POST") {
      const body = await readBody(req);
      const name = body && typeof body === "object" ? (body as { name?: unknown }).name : undefined;
      if (!validSectionName(name)) return json(res, 400, { error: "A section name is 1 to 60 characters without control characters.", code: "bad_name" });
      if (isGeneralName(name)) return json(res, 400, GENERAL);
      if (deps.sections().includes(name.trim())) return json(res, 409, { error: "A section with that name already exists.", code: "exists" });
      const error = deps.createSection(name.trim());
      if (error) return json(res, 409, { error });
      const record = deps.channels.ensure(name.trim(), deps.principalId(auth));
      deps.onChanged();
      deps.audit?.(auth, { action: "section.create", section: { id: record.id, name: record.name } });
      return json(res, 201, { section: sectionForViewer(viewer, record, deps.teamsOf) ?? { ...record, viewerRole: "owner", canModerate: true } });
    }

    const one = /^\/api\/org\/sections\/([^/]+)(?:\/(members|bots))?$/.exec(path);
    if (!one) return json(res, 404, { error: "not found" });
    if (one[1] === "general" || one[1] === "General") return json(res, 400, GENERAL);
    const record = deps.channels.byId(one[1]!);
    if (!record) return json(res, 404, { error: "no such section" });
    const access = recordAccess(record);
    const sub = one[2];

    if (!sub && method === "PATCH") {
      if (!canModerateSection(viewer, access)) return json(res, 403, NOT_ALLOWED);
      const body = await readBody(req);
      const name = body && typeof body === "object" ? (body as { name?: unknown }).name : undefined;
      if (!validSectionName(name)) return json(res, 400, { error: "A section name is 1 to 60 characters without control characters.", code: "bad_name" });
      if (isGeneralName(name)) return json(res, 400, GENERAL);
      const next = name.trim();
      if (next !== record.name) {
        const error = deps.renameSection(record.name, next);
        if (error) return json(res, 409, { error });
        deps.channels.rename(record.name, next);
        deps.onChanged();
        deps.audit?.(auth, { action: "section.rename", section: { id: record.id, name: next }, before: { name: record.name }, after: { name: next } });
      }
      const current = deps.channels.byId(record.id)!;
      return json(res, 200, { section: sectionForViewer(viewer, current, deps.teamsOf) ?? { ...current, viewerRole: null, canModerate: true } });
    }
    if (!sub && method === "DELETE") {
      if (!canModerateSection(viewer, access)) return json(res, 403, NOT_ALLOWED);
      const error = deps.deleteSection(record.name);
      if (error) return json(res, 409, { error });
      deps.channels.removeByName(record.name);
      deps.onChanged();
      deps.audit?.(auth, { action: "section.delete", section: { id: record.id, name: record.name } });
      return json(res, 200, { ok: true });
    }
    if (sub && method === "PUT") return json(res, 410, PERSONAL);
    return json(res, 405, { error: "method not allowed" });
  };
}
