// Rewrite of stored person references (emails, "local-owner") to principal
// ids. Pure over its inputs apart from the registry, which creates principals
// as it meets new emails. It runs on every boot: principal ids pass through,
// so running it twice changes nothing, and data restored or imported later
// is mapped too.
import { isAccountEmail, isPrincipalId, type PrincipalRegistry } from "../auth/principals.ts";

/** A person ref as a principal id. Only the literal "local-owner" is the
 * operator; a blank ref is nobody. A ref that is neither a principal id nor
 * an account email comes back unchanged and creates nothing. */
export function principalIdFor(raw: string, registry: PrincipalRegistry): string {
  const value = raw.trim();
  if (!value || isPrincipalId(value)) return value;
  const key = value.toLowerCase();
  if (key === "local-owner") return registry.localOperator().id;
  if (!isAccountEmail(key)) return value;
  const local = registry.local();
  if (local?.email && local.email === key) return local.id;
  return registry.forAccount({ email: key }).id;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export function migrateIdentityRefs(input: {
  org: { ownerUserId: string } | null;
  groups: { id: string; humanIds?: string[] }[];
  bots: { id: string; ownerUserId?: string; directGrants?: string[] }[];
  sessions: { id: string; label?: string; email?: string; userId?: string; principalId?: string; scopes?: readonly string[] }[];
  registry: PrincipalRegistry;
}) {
  const { registry } = input;
  const map = (raw: string) => principalIdFor(raw, registry);
  // Blank refs are nobody: they are dropped from lists, never the operator.
  const mapList = (list: string[]) => [...new Set(list.map(map).filter((id) => id !== ""))];
  const result: {
    orgOwner?: string;
    groups: { id: string; humanIds: string[] }[];
    bots: { id: string; ownerUserId?: string; directGrants?: string[] }[];
    sessions: { id: string; principalId: string }[];
    /** Legacy admin pairing sessions that now act as the local operator. */
    promoted: { id: string; label?: string }[];
  } = { groups: [], bots: [], sessions: [], promoted: [] };

  if (input.org) {
    const owner = map(input.org.ownerUserId);
    if (owner !== input.org.ownerUserId) result.orgOwner = owner;
  }
  for (const group of input.groups) {
    if (!group.humanIds?.length) continue;
    const next = mapList(group.humanIds);
    if (!sameList(next, group.humanIds)) result.groups.push({ id: group.id, humanIds: next });
  }
  for (const bot of input.bots) {
    const owner = bot.ownerUserId ? map(bot.ownerUserId) : undefined;
    const grants = bot.directGrants ? mapList(bot.directGrants) : undefined;
    const ownerChanged = owner !== bot.ownerUserId;
    const grantsChanged = grants !== undefined && !sameList(grants, bot.directGrants!);
    if (ownerChanged || grantsChanged) {
      result.bots.push({ id: bot.id, ...(owner ? { ownerUserId: owner } : {}), ...(grants ? { directGrants: grants } : {}) });
    }
  }
  for (const session of input.sessions) {
    if (session.principalId) continue;
    const email = session.email?.trim();
    const userId = session.userId?.trim();
    // Before principals, only an admin could mint a pairing code. So:
    // - email present: the person at that address.
    // - no email, no userId, admin scope: pairing session from before account tracking (operator's device).
    // - no email, no userId, chat-only scope: an anonymous device; no principal.
    // - no email, userId present: incomplete migration state; skip (no principal yet).
    if (!email && userId) continue;
    if (!email && !session.scopes?.includes("admin")) continue;
    // An address that is not an account email never becomes a person.
    if (email && !isAccountEmail(email)) continue;
    const principalId = email
      ? registry.forAccount({ email, controlPlaneUserId: userId && !userId.startsWith("portal:") ? userId : undefined }).id
      : registry.localOperator().id;
    result.sessions.push({ id: session.id, principalId });
    if (!email) result.promoted.push({ id: session.id, ...(session.label ? { label: session.label } : {}) });
  }
  return result;
}

export interface IdentityMigrationDeps {
  registry: PrincipalRegistry;
  org: { ownerUserId: string } | null;
  saveOrgOwner(ownerUserId: string): void;
  groups: { id: string; humanIds?: string[] }[];
  patchGroup(id: string, patch: { humanIds: string[] }): void;
  bots: { id: string; ownerUserId?: string; directGrants?: string[] }[];
  patchBot(id: string, patch: { ownerUserId?: string; directGrants?: string[] }): void;
  sessions: { id: string; label?: string; email?: string; userId?: string; principalId?: string; scopes?: readonly string[] }[];
  setPrincipal(sessionId: string, principalId: string): void;
  log?: (line: string) => void;
}

/** The boot wiring: map every stored ref and apply the changes. Runs on
 * every boot, so a restored workspace or an imported team is mapped too. */
export function applyIdentityMigration(deps: IdentityMigrationDeps): ReturnType<typeof migrateIdentityRefs> {
  const migrated = migrateIdentityRefs({
    org: deps.org,
    groups: deps.groups,
    bots: deps.bots,
    sessions: deps.sessions,
    registry: deps.registry,
  });
  if (migrated.orgOwner) deps.saveOrgOwner(migrated.orgOwner);
  for (const g of migrated.groups) deps.patchGroup(g.id, { humanIds: g.humanIds });
  for (const b of migrated.bots) {
    deps.patchBot(b.id, { ...(b.ownerUserId ? { ownerUserId: b.ownerUserId } : {}), ...(b.directGrants ? { directGrants: b.directGrants } : {}) });
  }
  for (const s of migrated.sessions) deps.setPrincipal(s.id, s.principalId);
  const log = deps.log ?? ((line: string) => console.log(line));
  for (const s of migrated.promoted) {
    log(`identity: paired device ${s.id} (${s.label ?? "no label"}) now acts as the local operator; revoke it in Settings if it is not yours`);
  }
  return migrated;
}

// ── Slice 8: copying a solo person's bots into an organization ─────────────

/** Why an organization copy is refused before anything is written. */
export type ImportRefusal = "foreign_owner" | "foreign_room" | "foreign_routine";

export interface ImportPeopleInput {
  /** The exporting person's local principal id: the only key of the table. */
  self: string;
  /** The importer's principal on the organization server. */
  importer: string;
  people: {
    bots: Record<string, { owner: string | null; grants: string[] }>;
    groups: Record<string, { humans: string[] }>;
    routines: { runAs: string | null }[];
  };
  /** Names for the report, by backup key. */
  names?: { bots?: Record<string, string>; groups?: Record<string, string>; routines?: string[] };
}

export interface ImportPeopleResult {
  ok: true;
  /** Every bot's owner on the organization server: the importer. */
  owners: Record<string, string>;
  /** Every room's people: the importer only. */
  groupsHumans: Record<string, string[]>;
  /** Every routine runs as the importer. */
  routinesRunAs: string[];
  /** People refs dropped (never turned into a right), counted per object. */
  removed: { object: "bot" | "room" | "routine"; sourceKey: string; name: string; refs: number }[];
}

/** The rewrite table of an organization copy is `{ self -> importer }`.
 * An owner, a room person or a routine runner other than `self` (or none)
 * refuses the whole copy; every grant other than `self` is dropped and
 * counted. Pure. */
export function rewritePeopleForImport(input: ImportPeopleInput): ImportPeopleResult | { ok: false; code: ImportRefusal; sourceKey: string } {
  const { self, importer, people } = input;
  const owners: Record<string, string> = {};
  const groupsHumans: Record<string, string[]> = {};
  const removed: ImportPeopleResult["removed"] = [];
  for (const [key, bot] of Object.entries(people.bots)) {
    if (bot.owner !== null && bot.owner !== self) return { ok: false, code: "foreign_owner", sourceKey: key };
    owners[key] = importer;
    const refs = new Set(bot.grants.filter((ref) => ref !== self)).size;
    if (refs) removed.push({ object: "bot", sourceKey: key, name: input.names?.bots?.[key] ?? key, refs });
  }
  for (const [key, group] of Object.entries(people.groups)) {
    if (group.humans.some((ref) => ref !== self)) return { ok: false, code: "foreign_room", sourceKey: key };
    groupsHumans[key] = [importer];
  }
  const routinesRunAs: string[] = [];
  for (const [index, routine] of people.routines.entries()) {
    if (routine.runAs !== null && routine.runAs !== self) return { ok: false, code: "foreign_routine", sourceKey: String(index) };
    routinesRunAs.push(importer);
  }
  return { ok: true, owners, groupsHumans, routinesRunAs, removed };
}

// ── Slice 8: attaching an interim person to a Perspicax person ─────────────

type GrantLevel = "use" | "run" | "edit" | "manage";
type MemberRole = "moderator" | "participant" | "readonly";
const GRANT_RANK: Record<GrantLevel, number> = { use: 1, run: 2, edit: 3, manage: 4 };
const ROLE_RANK: Record<MemberRole, number> = { readonly: 1, participant: 2, moderator: 3 };

export interface AttachRecords {
  bots: { id: string; ownerUserId?: string; directGrants?: string[]; grants?: { target: string; level: GrantLevel; by: string; at: number }[] }[];
  groups: { id: string; humanIds?: string[] }[];
  sections: { id: string; ownerPrincipalId: string; members: { target: string; role: MemberRole }[]; placedBots?: { botId: string; ownerPrincipalId: string }[] }[];
  routines: { id: string; runAs?: string }[];
}

export interface AttachResult {
  bots: { id: string; ownerUserId?: string; directGrants?: string[]; grants?: AttachRecords["bots"][number]["grants"] }[];
  groups: { id: string; humanIds: string[] }[];
  sections: AttachRecords["sections"];
  routines: { id: string; runAs: string }[];
  counts: { bots: number; grants: number; rooms: number; sections: number; routines: number };
}

/** Fold every reference to `from` into `to`. Refs to anyone else are kept
 * as they are. Where `to` already holds a grant or a section role, the
 * higher of the two stays. Only changed records are returned; a second
 * application changes nothing. Pure. */
export function rewritePeopleForAttach(table: { from: string; to: string }, records: AttachRecords): AttachResult {
  const { from, to } = table;
  const fromUser = `user:${from}`;
  const toUser = `user:${to}`;
  const result: AttachResult = { bots: [], groups: [], sections: [], routines: [], counts: { bots: 0, grants: 0, rooms: 0, sections: 0, routines: 0 } };
  const mapIds = (ids: string[]) => [...new Set(ids.map((id) => (id === from ? to : id)))];
  for (const bot of records.bots) {
    const ownerMoved = bot.ownerUserId === from;
    const directMoved = Boolean(bot.directGrants?.includes(from));
    const grantMoved = Boolean(bot.grants?.some((grant) => grant.target === fromUser));
    if (!ownerMoved && !directMoved && !grantMoved) continue;
    const next: AttachResult["bots"][number] = { id: bot.id };
    if (ownerMoved) {
      next.ownerUserId = to;
      result.counts.bots += 1;
    }
    if (directMoved) next.directGrants = mapIds(bot.directGrants!);
    if (grantMoved) {
      const moved = bot.grants!.find((grant) => grant.target === fromUser)!;
      const existing = bot.grants!.find((grant) => grant.target === toUser);
      const merged = existing && GRANT_RANK[existing.level] >= GRANT_RANK[moved.level] ? existing : { ...moved, target: toUser };
      next.grants = [...bot.grants!.filter((grant) => grant.target !== fromUser && grant.target !== toUser), merged];
      result.counts.grants += 1;
    }
    result.bots.push(next);
  }
  for (const group of records.groups) {
    if (!group.humanIds?.includes(from)) continue;
    result.groups.push({ id: group.id, humanIds: mapIds(group.humanIds) });
    result.counts.rooms += 1;
  }
  for (const section of records.sections) {
    const ownerMoved = section.ownerPrincipalId === from;
    const memberMoved = section.members.some((member) => member.target === fromUser);
    const placedMoved = Boolean(section.placedBots?.some((entry) => entry.ownerPrincipalId === from));
    if (!ownerMoved && !memberMoved && !placedMoved) continue;
    let members = section.members;
    if (memberMoved) {
      const moved = members.find((member) => member.target === fromUser)!;
      const existing = members.find((member) => member.target === toUser);
      const merged = existing && ROLE_RANK[existing.role] >= ROLE_RANK[moved.role] ? existing : { ...moved, target: toUser };
      members = members.filter((member) => member.target !== fromUser && member.target !== toUser);
      members.push(merged);
    }
    result.sections.push({
      ...section,
      ownerPrincipalId: ownerMoved ? to : section.ownerPrincipalId,
      members,
      ...(section.placedBots ? { placedBots: section.placedBots.map((entry) => (entry.ownerPrincipalId === from ? { ...entry, ownerPrincipalId: to } : entry)) } : {}),
    });
    result.counts.sections += 1;
  }
  for (const routine of records.routines) {
    if (routine.runAs !== from) continue;
    result.routines.push({ id: routine.id, runAs: to });
    result.counts.routines += 1;
  }
  return result;
}
