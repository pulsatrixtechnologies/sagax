// Visible roles, batch 5 (2026-11-05): the bot panel's "Rôles" tab. A small
// graph of the roles one person's bot used in the last seven days (nodes,
// "Moi" included) and the transitions between them (edges, with their
// count), plus the permissions a role was refused ("Permissions manquantes").
//
// Counts come from Perspicax's own journal of THIS person
// (`GET /api/v1/me/journal/requests`, the caller's own rows). Sagax's local
// transitions (server/perspicax/role-journal.ts) add each edge's reasons and
// threads. Isolation: rows of another bot (client_name) and rows acting as a
// profile this person does not hold are dropped here, whatever the journal
// served.
import type { CwPermission, RoleReason } from "./perspicax-roles.ts";

export const ROLE_GRAPH_WINDOW_MS = 7 * 24 * 60 * 60_000;
/** Two records of one transition (Sagax and the journal) at most this far apart. */
const MATCH_MS = 2 * 60_000;
const MAX_HISTORY = 50;

/** One row of Perspicax `mcp_requests` as `/api/v1/me/journal/requests` serves it. */
export interface JournalRequestRow {
  id?: string;
  ts: string;
  tool?: string;
  client_name?: string | null;
  mcp_session?: string | null;
  acting_as?: string | null;
  outcome?: string;
  error_code?: string | null;
}

/** A role this person holds (slug, name, Perspicax profile id when known). */
export interface GraphRole { slug: string; name: string; id?: string }

/** A transition Sagax recorded (RoleTransitionEntry). */
export interface LocalTransition {
  id: string;
  at: number;
  threadId: string;
  from: { slug: string; name: string };
  to: { slug: string; name: string };
  reason: RoleReason;
  refusedTool?: string;
}

export interface RoleGraphNode {
  slug: string;
  name: string;
  /** profile id, for a tooltip only */
  id?: string;
  /** calls under this role in the window (journal), else steps seen locally */
  calls: number;
}

export interface RoleGraphEvent {
  at: number;
  /** sagax: the thread's own record; perspicax: the journal; both: matched */
  source: "sagax" | "perspicax" | "both";
  threadId?: string;
  reason?: RoleReason;
  refusedTool?: string;
  /** the first call under the new role (journal) */
  tool?: string;
}

export interface RoleGraphEdge {
  from: string;
  to: string;
  /** seven-day count: the journal's when it answered, else Sagax's */
  count: number;
  history: RoleGraphEvent[];
}

export interface RoleGraph {
  nodes: RoleGraphNode[];
  edges: RoleGraphEdge[];
  /** perspicax: counts from the journal; local: the journal did not answer */
  journal: "perspicax" | "local";
}

/** One missing permission: refusals grouped by role and CW permission. */
export interface MissingPermission {
  /** the newest refusal's id (what "Envoyer à l'admin" names) */
  id: string;
  role: { slug: string; name: string };
  permission: CwPermission;
  kind: "read" | "write";
  /** the ConnectWise member behind the role (from `cw_member:<id>`) */
  member?: string;
  tools: string[];
  lastAt: number;
  count: number;
  sentAt?: number;
}

export interface RolesTabBody extends RoleGraph {
  missing: MissingPermission[];
}

/** The MCP client name Sagax gives Perspicax for one bot's connections. */
export function botClientName(botId: string): string {
  return `Pulsa Bot (${botId})`;
}

/** "cw_member:jdoe" is "jdoe"; anything else is not a member. */
export function memberOfTarget(target: string | undefined): string | undefined {
  if (!target || !target.startsWith("cw_member:")) return undefined;
  const member = target.slice("cw_member:".length).trim();
  return member ? member.slice(0, 120) : undefined;
}

function edgeKey(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

/** Build the graph. `rows` null: the journal did not answer (local alone). */
export function buildRoleGraph(input: {
  botId: string;
  roles: readonly GraphRole[];
  rows: readonly JournalRequestRow[] | null;
  local: readonly LocalTransition[];
  now: number;
  windowMs?: number;
}): RoleGraph {
  const since = input.now - (input.windowMs ?? ROLE_GRAPH_WINDOW_MS);
  const client = botClientName(input.botId);
  const byId = new Map<string, GraphRole>();
  const bySlug = new Map<string, GraphRole>();
  for (const role of input.roles) {
    if (!role.slug) continue;
    bySlug.set(role.slug, role);
    if (role.id) byId.set(role.id, role);
  }
  const calls = new Map<string, number>([["", 0]]);
  const names = new Map<string, string>([["", ""]]);
  const journalEdges = new Map<string, RoleGraphEvent[]>();

  if (input.rows) {
    // this bot's rows, acting as "Moi" or as a role this person holds
    const sessions = new Map<string, Array<{ at: number; slug: string; row: JournalRequestRow }>>();
    for (const row of input.rows) {
      if (!row || row.client_name !== client) continue;
      const at = Date.parse(row.ts);
      if (!Number.isFinite(at) || at < since || at > input.now + MATCH_MS) continue;
      let slug = "";
      if (row.acting_as) {
        const role = byId.get(row.acting_as);
        if (!role) continue;
        slug = role.slug;
        names.set(slug, role.name);
      }
      calls.set(slug, (calls.get(slug) ?? 0) + 1);
      if (!row.mcp_session) continue;
      const list = sessions.get(row.mcp_session) ?? [];
      list.push({ at, slug, row });
      sessions.set(row.mcp_session, list);
    }
    for (const list of sessions.values()) {
      list.sort((a, b) => a.at - b.at);
      for (let index = 1; index < list.length; index += 1) {
        const before = list[index - 1]!;
        const step = list[index]!;
        if (before.slug === step.slug) continue;
        const key = edgeKey(before.slug, step.slug);
        const events = journalEdges.get(key) ?? [];
        events.push({
          at: step.at,
          source: "perspicax",
          ...(step.row.tool ? { tool: step.row.tool } : {}),
          ...(before.row.outcome && before.row.outcome !== "ok" && before.row.tool ? { refusedTool: before.row.tool } : {}),
        });
        journalEdges.set(key, events);
      }
    }
  }

  // Sagax's own transitions: reasons and threads
  const localEdges = new Map<string, LocalTransition[]>();
  for (const transition of input.local) {
    if (transition.at < since) continue;
    const from = transition.from.slug;
    const to = transition.to.slug;
    if (from === to) continue;
    // Sagax's own records are this person's already (read by principal)
    if (from) names.set(from, bySlug.get(from)?.name || transition.from.name || from);
    if (to) names.set(to, bySlug.get(to)?.name || transition.to.name || to);
    const key = edgeKey(from, to);
    const list = localEdges.get(key) ?? [];
    list.push(transition);
    localEdges.set(key, list);
  }

  const edges: RoleGraphEdge[] = [];
  for (const key of new Set([...journalEdges.keys(), ...localEdges.keys()])) {
    const [from, to] = key.split("\u0000") as [string, string];
    const journal = [...(journalEdges.get(key) ?? [])].sort((a, b) => a.at - b.at);
    const mine = [...(localEdges.get(key) ?? [])].sort((a, b) => a.at - b.at);
    const used = new Set<number>();
    const history: RoleGraphEvent[] = [];
    for (const transition of mine) {
      let best = -1;
      for (let index = 0; index < journal.length; index += 1) {
        if (used.has(index)) continue;
        const gap = Math.abs(journal[index]!.at - transition.at);
        if (gap <= MATCH_MS && (best < 0 || gap < Math.abs(journal[best]!.at - transition.at))) best = index;
      }
      const matched = best >= 0 ? journal[best] : undefined;
      if (best >= 0) used.add(best);
      const refusedTool = transition.refusedTool ?? matched?.refusedTool;
      history.push({
        at: transition.at,
        source: matched ? "both" : "sagax",
        threadId: transition.threadId,
        reason: transition.reason,
        ...(refusedTool ? { refusedTool } : {}),
        ...(matched?.tool ? { tool: matched.tool } : {}),
      });
    }
    journal.forEach((event, index) => { if (!used.has(index)) history.push(event); });
    history.sort((a, b) => b.at - a.at);
    const count = input.rows ? journal.length : mine.length;
    if (count === 0 && history.length === 0) continue;
    edges.push({ from, to, count, history: history.slice(0, MAX_HISTORY) });
    for (const slug of [from, to]) if (!calls.has(slug)) calls.set(slug, 0);
  }
  if (!input.rows) {
    // no journal: a role's weight is the transitions that reached it
    for (const edge of edges) calls.set(edge.to, (calls.get(edge.to) ?? 0) + edge.count);
  }

  const nodes: RoleGraphNode[] = [...calls.entries()]
    .filter(([slug, count]) => slug === "" || count > 0 || edges.some((edge) => edge.from === slug || edge.to === slug))
    .map(([slug, count]) => {
      const role = bySlug.get(slug);
      return { slug, name: slug ? names.get(slug) || role?.name || slug : "", ...(role?.id ? { id: role.id } : {}), calls: count };
    })
    .sort((a, b) => (a.slug === "" ? -1 : b.slug === "" ? 1 : b.calls - a.calls || a.name.localeCompare(b.name)));
  edges.sort((a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return { nodes, edges, journal: input.rows ? "perspicax" : "local" };
}

/** A refusal as role-journal.ts keeps it (RoleRefusalEntry). */
export interface RefusalLike {
  id: string;
  at: number;
  role: { slug: string; name: string };
  tool: string;
  kind: "read" | "write";
  permission: CwPermission;
  target?: string;
  sentAt?: number;
}

/** Refusals grouped by role and ConnectWise permission, newest first. */
export function missingPermissions(refusals: readonly RefusalLike[]): MissingPermission[] {
  const groups = new Map<string, MissingPermission>();
  for (const refusal of [...refusals].sort((a, b) => b.at - a.at)) {
    const p = refusal.permission;
    const key = [refusal.role.slug, p.module, p.func, p.path, p.operation].join("\u0000");
    const group = groups.get(key);
    if (!group) {
      const member = memberOfTarget(refusal.target);
      groups.set(key, {
        id: refusal.id, role: refusal.role, permission: p, kind: refusal.kind,
        ...(member ? { member } : {}),
        tools: [refusal.tool], lastAt: refusal.at, count: 1,
        ...(refusal.sentAt ? { sentAt: refusal.sentAt } : {}),
      });
      continue;
    }
    group.count += 1;
    if (!group.tools.includes(refusal.tool) && group.tools.length < 5) group.tools.push(refusal.tool);
    if (!group.member) { const member = memberOfTarget(refusal.target); if (member) group.member = member; }
    if (refusal.kind === "write") group.kind = "write";
  }
  return [...groups.values()];
}
