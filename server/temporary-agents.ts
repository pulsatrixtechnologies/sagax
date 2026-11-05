// Temporary agents (Perspicax #321, the decisions of 2026-10-14): every bot
// that create_agent makes, for a person's AI client or for a bot, is
// temporary. This file is the rules only, with no store and no clock of its
// own; server/index.ts applies them.
//
//   - It belongs to the person who called (a bot's call: the person its turn
//     speaks for, else the calling bot's owner).
//   - It expires after idleHours of inactivity (24 by default, set per
//     create_agent call or by SAGAX_TEMP_AGENT_IDLE_HOURS), unless a person
//     pinned it.
//   - At most TEMP_AGENT_QUOTA active ones per person.
//   - Depth 1: a temporary agent never creates another.
//   - Hidden from the Sagax app (GET /api/bots, the event stream), but
//     listed and addressable through the agent API.
//   - delete_agent and expiry archive it: it stops answering and leaves every
//     list, and its conversations stay on disk for TEMP_AGENT_RETENTION_MS
//     before the bot is deleted for good.
//   - Only its owner or an organization admin deletes it (a bot only one it
//     created itself, for the same owner).

export const TEMP_AGENT_IDLE_HOURS_DEFAULT = 24;
export const TEMP_AGENT_IDLE_HOURS_MAX = 720;
export const TEMP_AGENT_QUOTA = 10;
export const TEMP_AGENT_RETENTION_MS = 30 * 24 * 3_600_000;
/** How often the server looks for expired and purgeable agents. */
export const TEMP_AGENT_SWEEP_MS = 5 * 60_000;

export type TemporaryCreator =
  | { kind: "person"; principalId: string }
  | { kind: "bot"; botId: string; speakerPrincipalId?: string };

export type ArchiveActor = { kind: "person"; principalId: string } | { kind: "bot"; botId: string } | { kind: "system" };

export interface TemporaryAgent {
  via: "mcp";
  createdAt: number;
  /** The person it belongs to; null only on a server with no owner to name. */
  ownerPrincipalId: string | null;
  createdBy: TemporaryCreator;
  idleHours: number;
  /** The last prompt sent to it (the bot's own activity also counts). */
  lastActiveAt: number;
  /** Pinned by a person: it never expires (delete_agent still archives it). */
  pinned?: { principalId: string; at: number };
  archived?: { at: number; by: ArchiveActor; reason: "deleted" | "expired"; purgeAt: number };
  /** Where its Auto turns start (create_agent `workspace`,
   * server/computer/auto-computer.ts autoStartTarget); checked at every turn. */
  workspace?: "this_computer" | "browser" | "cloud" | "local_vm";
}

const PRINCIPAL = /^[\w:.@-]{1,200}$/;
const BOT_ID = /^[\w-]{1,128}$/;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

function cleanCreator(value: unknown): TemporaryCreator | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.kind === "person" && typeof v.principalId === "string" && PRINCIPAL.test(v.principalId)) return { kind: "person", principalId: v.principalId };
  if (v.kind === "bot" && typeof v.botId === "string" && BOT_ID.test(v.botId)) {
    return { kind: "bot", botId: v.botId, ...(typeof v.speakerPrincipalId === "string" && PRINCIPAL.test(v.speakerPrincipalId) ? { speakerPrincipalId: v.speakerPrincipalId } : {}) };
  }
  return null;
}

function cleanActor(value: unknown): ArchiveActor | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.kind === "system") return { kind: "system" };
  if (v.kind === "person" && typeof v.principalId === "string" && PRINCIPAL.test(v.principalId)) return { kind: "person", principalId: v.principalId };
  if (v.kind === "bot" && typeof v.botId === "string" && BOT_ID.test(v.botId)) return { kind: "bot", botId: v.botId };
  return null;
}

/** A stored value as a valid record, or undefined (a malformed one is
 * dropped, and the bot is then an ordinary one). */
export function cleanTemporaryAgent(value: unknown): TemporaryAgent | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const createdBy = cleanCreator(v.createdBy);
  if (v.via !== "mcp" || !finite(v.createdAt) || !createdBy || !finite(v.lastActiveAt)) return undefined;
  if (v.ownerPrincipalId !== null && !(typeof v.ownerPrincipalId === "string" && PRINCIPAL.test(v.ownerPrincipalId))) return undefined;
  const idle = typeof v.idleHours === "number" && Number.isInteger(v.idleHours) && v.idleHours >= 1 && v.idleHours <= TEMP_AGENT_IDLE_HOURS_MAX ? v.idleHours : TEMP_AGENT_IDLE_HOURS_DEFAULT;
  const out: TemporaryAgent = { via: "mcp", createdAt: v.createdAt, ownerPrincipalId: v.ownerPrincipalId as string | null, createdBy, idleHours: idle, lastActiveAt: v.lastActiveAt };
  const pinned = v.pinned as Record<string, unknown> | undefined;
  if (pinned && typeof pinned.principalId === "string" && PRINCIPAL.test(pinned.principalId) && finite(pinned.at)) out.pinned = { principalId: pinned.principalId, at: pinned.at };
  const archived = v.archived as Record<string, unknown> | undefined;
  const by = archived ? cleanActor(archived.by) : null;
  if (archived && by && finite(archived.at) && finite(archived.purgeAt) && (archived.reason === "deleted" || archived.reason === "expired")) {
    out.archived = { at: archived.at, by, reason: archived.reason, purgeAt: archived.purgeAt };
  }
  if (v.workspace === "this_computer" || v.workspace === "browser" || v.workspace === "cloud" || v.workspace === "local_vm") out.workspace = v.workspace;
  return out;
}

/** The default idle expiry: SAGAX_TEMP_AGENT_IDLE_HOURS when it is a whole
 * number of hours in range, else 24. */
export function defaultIdleHours(env: Record<string, string | undefined>): number {
  const raw = env.SAGAX_TEMP_AGENT_IDLE_HOURS?.trim();
  const n = raw ? Number(raw) : Number.NaN;
  return Number.isInteger(n) && n >= 1 && n <= TEMP_AGENT_IDLE_HOURS_MAX ? n : TEMP_AGENT_IDLE_HOURS_DEFAULT;
}

/** The person a new temporary agent belongs to. */
export function temporaryOwner(creator: TemporaryCreator, creatorBotOwner: string | null): string | null {
  if (creator.kind === "person") return creator.principalId;
  return creator.speakerPrincipalId ?? creatorBotOwner;
}

/** What counts against one quota: the owner, else the creating bot. */
export function quotaKey(agent: Pick<TemporaryAgent, "ownerPrincipalId" | "createdBy">): string {
  if (agent.ownerPrincipalId) return `person:${agent.ownerPrincipalId}`;
  return agent.createdBy.kind === "bot" ? `bot:${agent.createdBy.botId}` : `person:${agent.createdBy.principalId}`;
}

/** The active (not archived) temporary agents counted under `key`. */
export function activeCount(agents: Iterable<TemporaryAgent | undefined>, key: string): number {
  let n = 0;
  for (const agent of agents) if (agent && !agent.archived && quotaKey(agent) === key) n++;
  return n;
}

/** Whether an active, unpinned agent has been idle past its expiry. */
export function expired(agent: TemporaryAgent, lastActivity: number, now: number): boolean {
  if (agent.archived || agent.pinned) return false;
  return now - Math.max(agent.lastActiveAt, lastActivity) >= agent.idleHours * 3_600_000;
}

/** Whether an archived agent's retention is over (the bot is deleted). */
export function purgeDue(agent: TemporaryAgent, now: number): boolean {
  return Boolean(agent.archived && now >= agent.archived.purgeAt);
}

/** The archive mark for now. */
export function archiveMark(by: ArchiveActor, reason: "deleted" | "expired", now: number): NonNullable<TemporaryAgent["archived"]> {
  return { at: now, by, reason, purgeAt: now + TEMP_AGENT_RETENTION_MS };
}

export type DeleteActor =
  | { kind: "person"; principalId: string; admin: boolean }
  | { kind: "bot"; botId: string; ownerPrincipalId: string | null };

/** Who may delete (archive) a temporary agent: its owner or an organization
 * admin; a bot only one it created itself, for the same owner. */
export function mayDelete(agent: TemporaryAgent, actor: DeleteActor): boolean {
  if (actor.kind === "person") return actor.admin || (agent.ownerPrincipalId !== null && agent.ownerPrincipalId === actor.principalId);
  return agent.createdBy.kind === "bot" && agent.createdBy.botId === actor.botId && agent.ownerPrincipalId === actor.ownerPrincipalId;
}

/** Who may pin or unpin one: a person, its owner or an organization admin. */
export function mayPin(agent: TemporaryAgent, person: { principalId: string; admin: boolean }): boolean {
  return person.admin || (agent.ownerPrincipalId !== null && agent.ownerPrincipalId === person.principalId);
}

// ── the profile get_agent reads ─────────────────────────────────────────

export const PROFILE_SECTION_MAX = 8_000;
export const PROFILE_INSTRUCTIONS_MAX = 32_000;

export interface ProfileSections {
  persona: string | null;
  rules: string | null;
  voice: string | null;
  anti_jobs: string | null;
  /** Every heading of the instructions, in order. */
  headings: string[];
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const KINDS: Array<[keyof Omit<ProfileSections, "headings">, RegExp]> = [
  // anti-jobs first: "what you do not do" must not land in rules
  ["anti_jobs", /anti[\s_-]*jobs?|not (?:your|my) jobs?|out of scope|hors (?:du )?mandat|ce que (?:tu|je) ne fais? pas|ne (?:fais|fait) pas|never do|(?:don'?t|do not) do|a ne pas faire/],
  ["persona", /persona|identit|who (?:you|i) (?:are|am)|qui (?:tu es|je suis)|^(?:role|mission)\b/],
  ["rules", /r[e]gles?|rules?|guardrails?|garde[\s-]*fous?|consignes?|contraintes?/],
  ["voice", /voi[xc]e?|\btone\b|\bton\b|style|ecriture|writing/],
];

const cap = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}\n[...]` : text);

/** The persona, rules, voice and anti-jobs sections of a bot's instructions,
 * by their markdown headings (French or English). The persona falls back to
 * the text before the first heading. */
export function profileSections(soul: string): ProfileSections {
  const out: ProfileSections = { persona: null, rules: null, voice: null, anti_jobs: null, headings: [] };
  const lines = (soul ?? "").split(/\r?\n/);
  let current: { kind: keyof Omit<ProfileSections, "headings"> | null; level: number } | null = null;
  const lead: string[] = [];
  const bodies = new Map<string, string[]>();
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const title = heading[2]!.trim();
      out.headings.push(title);
      // a subheading stays in its section
      if (current?.kind && level > current.level) {
        bodies.get(current.kind)!.push(line);
        continue;
      }
      const kind = KINDS.find(([, pattern]) => pattern.test(fold(title)))?.[0] ?? null;
      current = { kind, level };
      if (kind && !bodies.has(kind)) bodies.set(kind, []);
      continue;
    }
    if (!current) lead.push(line);
    else if (current.kind) bodies.get(current.kind)!.push(line);
  }
  for (const [kind, body] of bodies) {
    const text = body.join("\n").trim();
    if (text) out[kind as keyof Omit<ProfileSections, "headings">] = cap(text, PROFILE_SECTION_MAX);
  }
  if (!out.persona) {
    const text = lead.join("\n").trim();
    if (text) out.persona = cap(text, PROFILE_SECTION_MAX);
  }
  return out;
}

export function capInstructions(soul: string): { text: string; truncated: boolean } {
  const text = soul ?? "";
  return text.length > PROFILE_INSTRUCTIONS_MAX ? { text: `${text.slice(0, PROFILE_INSTRUCTIONS_MAX)}\n[...]`, truncated: true } : { text, truncated: false };
}
