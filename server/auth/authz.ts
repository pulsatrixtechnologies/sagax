// Who may do what on an organization server (slice 4). Pure: no store, no
// request. index.ts builds the facts (the viewer, a bot's owner, grants and
// section, a room's people) and asks here.
//
// Levels on a bot, each one containing the ones before it:
//   use     see the bot, open its conversations, write to it
//   run     create, change, delete or run a routine that targets it
//   edit    change its display fields and instructions (MEMBER_BOT_FIELDS)
//   manage  administer its grants (up to edit; only the owner or an
//           organization admin gives manage)
// The owner stands above manage. A person's level is the highest of their
// user grants, the grants to every team they are in, and the membership of
// the bot's section (capped at run). A disabled person has none.
//
// Organization admins administer every grant but open no bot without one.
// A team manager administers grants that target a team they manage or a
// member of it: adding or raising needs an anchor (the bot already carries
// a grant, given by someone else, to one of the teams they manage) and goes
// up to that anchor's level; lowering or removing is always allowed. She
// never adds or raises an entry for herself or a co-manager of her teams.
//
// The operator at this computer (loopback) has no viewer: undefined sees and
// administers everything, as before.
//
// Spec: docs/superpowers/specs/2026-09-29-perspicax-multiuser-design.md,
// section 3 (rights, sections as channels), decisions 5 and 6.

export type Level = "use" | "run" | "edit" | "manage";
export const LEVELS: readonly Level[] = ["use", "run", "edit", "manage"];
export type SectionRole = "moderator" | "participant" | "readonly";
export const SECTION_ROLES: readonly SectionRole[] = ["readonly", "participant", "moderator"];

export interface TeamRef {
  id: string;
  manager: boolean;
}

export interface Viewer {
  principalId: string;
  orgAdmin: boolean;
  teams: TeamRef[];
  disabled: boolean;
  /** Organization server: a Perspicax admin let this person use shared
   * bots only (`sagax_bots: use`): every bot level they hold, their own
   * bots included, reads as `use` (botLevel). Never set for an admin. */
  botsReadOnly?: boolean;
}

export interface BotGrant {
  /** `user:<principal id>` or `team:<Perspicax team id>`. */
  target: string;
  level: Level;
  /** Who gave it (principal id). */
  by: string;
  /** When, ms since the epoch. */
  at: number;
}

export interface SectionMember {
  target: string;
  role: SectionRole;
}

export interface SectionAccess {
  ownerPrincipalId?: string;
  members: SectionMember[];
  defaultLevel: "use" | "run";
}

export interface BotFacts {
  ownerPrincipalId: string;
  grants: readonly BotGrant[];
  /** The shared section the bot sits in, if any. */
  sections?: readonly SectionAccess[];
}

export function isLevel(value: unknown): value is Level {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

export function isSectionRole(value: unknown): value is SectionRole {
  return typeof value === "string" && (SECTION_ROLES as readonly string[]).includes(value);
}

export function levelRank(level: Level | "owner" | null | undefined): number {
  if (!level) return 0;
  if (level === "owner") return LEVELS.length + 1;
  return LEVELS.indexOf(level) + 1;
}

export function atLeast(level: Level | "owner" | null | undefined, needed: Level): boolean {
  return levelRank(level) >= levelRank(needed);
}

/** The lower of two levels. */
export function capLevel(level: Level, cap: Level): Level {
  return levelRank(level) <= levelRank(cap) ? level : cap;
}

export function roleRank(role: SectionRole | "owner" | null | undefined): number {
  if (!role) return 0;
  if (role === "owner") return SECTION_ROLES.length + 1;
  return SECTION_ROLES.indexOf(role) + 1;
}

const key = (value: string) => value.trim().toLowerCase();

/** A grant or member target: `user:<id>` or `team:<id>`. */
export function parseTarget(target: string): { kind: "user" | "team"; id: string } | null {
  const match = /^(user|team):(.+)$/.exec(target);
  if (!match) return null;
  const id = match[2]!;
  if (match[1] === "user") return /^pr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ? { kind: "user", id } : null;
  return /^[0-9A-Za-z]{1,64}$/.test(id) ? { kind: "team", id } : null;
}

/** Whether a target (`user:`, `team:`, or a bare principal id as rooms
 * store people) names this viewer. */
export function targetNamesViewer(viewer: Viewer, target: string): boolean {
  if (target.startsWith("team:")) {
    // A team's members; its managers administer its grants but open
    // nothing through them (a manager never reads a Direct unasked).
    const id = target.slice(5);
    return viewer.teams.some((team) => team.id === id && !team.manager);
  }
  const id = target.startsWith("user:") ? target.slice(5) : target;
  return key(id) === key(viewer.principalId);
}

/** The highest level a set of grants gives this viewer, or null. */
export function grantLevel(viewer: Viewer, grants: readonly BotGrant[]): Level | null {
  let best: Level | null = null;
  for (const grant of grants) {
    if (!isLevel(grant.level) || !targetNamesViewer(viewer, grant.target)) continue;
    if (levelRank(grant.level) > levelRank(best)) best = grant.level;
  }
  return best;
}

/** The viewer's role in a shared section: owner, their best member entry
 * (user or team), or null. */
export function sectionRole(viewer: Viewer, section: SectionAccess): SectionRole | "owner" | null {
  if (section.ownerPrincipalId && key(section.ownerPrincipalId) === key(viewer.principalId)) return "owner";
  let best: SectionRole | null = null;
  for (const member of section.members) {
    if (!isSectionRole(member.role) || !targetNamesViewer(viewer, member.target)) continue;
    if (roleRank(member.role) > roleRank(best)) best = member.role;
  }
  return best;
}

/** A viewer's level on a bot (decision D3), or null. */
export function botLevel(input: { viewer: Viewer } & BotFacts): Level | "owner" | null {
  const level = heldBotLevel(input);
  return level && input.viewer.botsReadOnly && !input.viewer.orgAdmin ? "use" : level;
}

function heldBotLevel(input: { viewer: Viewer } & BotFacts): Level | "owner" | null {
  const { viewer } = input;
  if (viewer.disabled) return null;
  if (key(input.ownerPrincipalId) === key(viewer.principalId)) return "owner";
  let best: Level | null = grantLevel(viewer, input.grants);
  for (const section of input.sections ?? []) {
    // Member entries only: owning a section never opens the bots others
    // placed in it before it was shared.
    const role = sectionRole(viewer, { ...section, ownerPrincipalId: undefined });
    if (!role) continue;
    const level = capLevel(section.defaultLevel, "run");
    if (levelRank(level) > levelRank(best)) best = level;
  }
  return best;
}

/** Bot actions. Undefined viewer: the operator at this computer. */
export function canOnBot(viewer: Viewer | undefined, action: "bot.use" | "bot.run" | "bot.edit" | "bot.manage", bot: BotFacts): boolean {
  if (!viewer) return true;
  const level = botLevel({ viewer, ...bot });
  const needed: Level = action === "bot.use" ? "use" : action === "bot.run" ? "run" : action === "bot.edit" ? "edit" : "manage";
  return atLeast(level, needed);
}

/** The team ids this viewer manages. */
export function managedTeamIds(viewer: Viewer): string[] {
  return viewer.teams.filter((team) => team.manager).map((team) => team.id);
}

/** Whether a manager's rights reach a target: a team they manage, or a
 * person in one of those teams. */
export function managerReaches(viewer: Viewer, target: string, teamsOf: (principalId: string) => readonly TeamRef[]): boolean {
  const managed = new Set(managedTeamIds(viewer));
  if (!managed.size) return false;
  const parsed = parseTarget(target);
  if (!parsed) return false;
  if (parsed.kind === "team") return managed.has(parsed.id);
  return teamsOf(parsed.id).some((team) => managed.has(team.id));
}

/** Whether a manager may add or raise an entry for this target: it must be
 * reachable, and name neither the manager herself nor another manager of
 * one of her teams. A manager administers her teams' access without ever
 * opening what she administers, and two managers can't open it for each
 * other. Lowering or removing such an entry stays allowed. */
export function managerMayGive(viewer: Viewer, target: string, teamsOf: (principalId: string) => readonly TeamRef[]): boolean {
  if (!managerReaches(viewer, target, teamsOf)) return false;
  const parsed = parseTarget(target);
  if (!parsed || parsed.kind === "team") return Boolean(parsed);
  if (key(parsed.id) === key(viewer.principalId)) return false;
  const managed = new Set(managedTeamIds(viewer));
  return !teamsOf(parsed.id).some((team) => team.manager && managed.has(team.id));
}

/** The anchor of a manager on a bot: the highest level of a grant, given by
 * someone else, to one of the teams they manage. */
export function managerAnchor(viewer: Viewer, grants: readonly BotGrant[]): Level | null {
  const managed = new Set(managedTeamIds(viewer));
  let best: Level | null = null;
  for (const grant of grants) {
    const parsed = parseTarget(grant.target);
    if (!parsed || parsed.kind !== "team" || !managed.has(parsed.id)) continue;
    if (key(grant.by) === key(viewer.principalId)) continue;
    if (levelRank(grant.level) > levelRank(best)) best = grant.level;
  }
  return best;
}

export interface GrantChange {
  bot: BotFacts;
  target: string;
  /** The level asked for; undefined for a removal. */
  newLevel?: Level;
  /** How other people's teams are read (manager rule). */
  teamsOf: (principalId: string) => readonly TeamRef[];
}

/** Decision D4: may this viewer add, change or remove this grant? */
export function canAdministerGrant(viewer: Viewer | undefined, change: GrantChange): boolean {
  if (!viewer) return true;
  if (viewer.disabled) return false;
  const level = botLevel({ viewer, ...change.bot });
  if (level === "owner" || viewer.orgAdmin) return true;
  const current = change.bot.grants.find((grant) => grant.target === change.target)?.level;
  if (level === "manage") {
    // A manage holder shares up to edit and never touches a manage grant.
    if (current === "manage") return false;
    return change.newLevel === undefined || levelRank(change.newLevel) <= levelRank("edit");
  }
  if (!managerReaches(viewer, change.target, change.teamsOf)) return false;
  // Lowering or removing a grant to their team or its members: always.
  if (change.newLevel === undefined) return current !== undefined;
  if (current !== undefined && levelRank(change.newLevel) <= levelRank(current)) return true;
  if (!managerMayGive(viewer, change.target, change.teamsOf)) return false;
  const anchor = managerAnchor(viewer, change.bot.grants);
  // Up to the anchor and never beyond edit: only the owner or an
  // organization admin gives manage.
  return anchor !== null && levelRank(change.newLevel) <= Math.min(levelRank(anchor), levelRank("edit"));
}

/** What the grant editor offers this viewer on a bot. `any`: every target;
 * else only `teamIds` (and their members). `maxLevel`: the highest level
 * they may give; `canAdd`: whether they may add at all. */
export function grantAdministration(viewer: Viewer | undefined, bot: BotFacts): { any: boolean; teamIds: string[]; maxLevel: Level; canAdd: boolean } | null {
  if (!viewer) return { any: true, teamIds: [], maxLevel: "manage", canAdd: true };
  if (viewer.disabled) return null;
  const level = botLevel({ viewer, ...bot });
  if (level === "owner" || viewer.orgAdmin) return { any: true, teamIds: [], maxLevel: "manage", canAdd: true };
  if (level === "manage") return { any: true, teamIds: [], maxLevel: "edit", canAdd: true };
  const teamIds = managedTeamIds(viewer);
  if (!teamIds.length) return null;
  const anchor = managerAnchor(viewer, bot.grants);
  return { any: false, teamIds, maxLevel: anchor ? capLevel(anchor, "edit") : "use", canAdd: anchor !== null };
}

/** A room's (or a section conversation's) access for a viewer: listed
 * people (by id or team) post; a shared section adds its members' roles. */
export function roomAccess(input: { viewer: Viewer | undefined; humanIds: readonly string[]; section?: SectionAccess | null }): SectionRole | "owner" | null {
  const { viewer } = input;
  if (!viewer) return "owner";
  if (viewer.disabled) return null;
  let best: SectionRole | "owner" | null = null;
  if (input.humanIds.some((entry) => targetNamesViewer(viewer, entry))) best = "participant";
  if (input.section) {
    const role = sectionRole(viewer, input.section);
    if (roleRank(role) > roleRank(best)) best = role;
  }
  return best;
}

export function canInChannel(viewer: Viewer | undefined, action: "channel.read" | "channel.post", room: { humanIds: readonly string[]; section?: SectionAccess | null }): boolean {
  const role = roomAccess({ viewer, ...room });
  if (!role) return false;
  return action === "channel.read" || role !== "readonly";
}

/** channel.moderate on a shared section: its owner, its moderators, an
 * organization admin. (Managers act on their own entries through
 * canAdministerSectionMember.) */
export function canModerateSection(viewer: Viewer | undefined, section: SectionAccess): boolean {
  if (!viewer) return true;
  if (viewer.disabled) return false;
  if (viewer.orgAdmin) return true;
  const role = sectionRole(viewer, section);
  return role === "owner" || role === "moderator";
}

/** section.administer: may this viewer set (or remove, role undefined) the
 * member entry for `target`? Moderators and admins: any entry. A manager:
 * entries for their teams and members; adding or raising needs the section
 * to list one of their teams already (the anchor, by role). */
export function canAdministerSectionMember(viewer: Viewer | undefined, input: { section: SectionAccess; target: string; role?: SectionRole; teamsOf: (principalId: string) => readonly TeamRef[] }): boolean {
  if (!viewer) return true;
  if (canModerateSection(viewer, input.section)) return true;
  if (viewer.disabled || !managerReaches(viewer, input.target, input.teamsOf)) return false;
  const current = input.section.members.find((member) => member.target === input.target)?.role;
  if (input.role === undefined) return current !== undefined;
  if (current !== undefined && roleRank(input.role) <= roleRank(current)) return true;
  if (!managerMayGive(viewer, input.target, input.teamsOf)) return false;
  const managed = new Set(managedTeamIds(viewer));
  let anchor: SectionRole | null = null;
  for (const member of input.section.members) {
    const parsed = parseTarget(member.target);
    if (parsed?.kind === "team" && managed.has(parsed.id) && roleRank(member.role) > roleRank(anchor)) anchor = member.role;
  }
  return anchor !== null && roleRank(input.role) <= roleRank(anchor);
}

/** Decision D5: may this viewer change a room's people from `before` to
 * `after`? Admins: yes. A manager: only entries of their teams or their
 * members change, and adding one needs the room to list one of their teams
 * already. Anyone else: no (the caller keeps its older rule for owners). */
export function canEditRoomHumans(viewer: Viewer | undefined, input: { before: readonly string[]; after: readonly string[]; teamsOf: (principalId: string) => readonly TeamRef[] }): boolean {
  if (!viewer) return true;
  if (viewer.disabled) return false;
  if (viewer.orgAdmin) return true;
  const managed = new Set(managedTeamIds(viewer));
  if (!managed.size) return false;
  const asTarget = (entry: string) => (entry.startsWith("team:") || entry.startsWith("user:") ? entry : `user:${entry}`);
  const before = new Set(input.before);
  const after = new Set(input.after);
  const added = [...after].filter((entry) => !before.has(entry));
  const removed = [...before].filter((entry) => !after.has(entry));
  if ([...added, ...removed].some((entry) => !managerReaches(viewer, asTarget(entry), input.teamsOf))) return false;
  if (!added.length) return true;
  if (added.some((entry) => !managerMayGive(viewer, asTarget(entry), input.teamsOf))) return false;
  return input.before.some((entry) => entry.startsWith("team:") && managed.has(entry.slice(5)));
}

export type Action =
  | "bot.use" | "bot.run" | "bot.edit" | "bot.manage"
  | "channel.read" | "channel.post" | "channel.moderate"
  | "org.settings" | "grant.administer" | "section.administer";

export type Resource =
  | { kind: "bot"; bot: BotFacts }
  | { kind: "room"; humanIds: readonly string[]; section?: SectionAccess | null }
  | { kind: "section"; section: SectionAccess }
  | { kind: "org" }
  | { kind: "grant"; change: GrantChange }
  | { kind: "section-member"; section: SectionAccess; target: string; role?: SectionRole; teamsOf: (principalId: string) => readonly TeamRef[] };

/** One entry point for every rule above. */
export function can(viewer: Viewer | undefined, action: Action, resource: Resource): boolean {
  switch (action) {
    case "bot.use":
    case "bot.run":
    case "bot.edit":
    case "bot.manage":
      return resource.kind === "bot" && canOnBot(viewer, action, resource.bot);
    case "channel.read":
    case "channel.post":
      return resource.kind === "room" && canInChannel(viewer, action, resource);
    case "channel.moderate":
      if (resource.kind === "section") return canModerateSection(viewer, resource.section);
      if (resource.kind === "room") return !viewer || (!viewer.disabled && (viewer.orgAdmin || roomAccess({ viewer, ...resource }) === "moderator" || roomAccess({ viewer, ...resource }) === "owner"));
      return false;
    case "org.settings":
      return !viewer || (!viewer.disabled && viewer.orgAdmin);
    case "grant.administer":
      return resource.kind === "grant" && canAdministerGrant(viewer, resource.change);
    case "section.administer":
      return resource.kind === "section-member" && canAdministerSectionMember(viewer, resource);
  }
}
