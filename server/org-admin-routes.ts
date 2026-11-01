// The organization admin API the Perspicax console reads through its proxy
// (slice 7, spec section 8 "/api/org/admin/*"):
//
//   GET  /api/org/admin/bots                     manager, admin
//   GET  /api/org/admin/usage?from&to            manager, admin
//   GET  /api/org/admin/approvals                any role
//   POST /api/org/admin/approvals/{t}/{r}        any role, { decision }
//   GET  /api/org/admin/audit?from&to&limit&before  admin
//   GET  /api/org/admin/files/{bot}/roots|list|stat|read|download
//                                                manager, admin (org-admin-files.ts)
//
// Answered before the auth gate and before loopback trust: the only
// credential is a console assertion Perspicax signs per request (typ
// `pulsabot-console+jwt`, server/oidc-rp.ts verifyConsoleAssertion). A
// session cookie is ignored here, and a loopback request without an
// assertion is 401, never "the owner at this computer".
//
// Every answer is metadata: no message text, no instructions, no memory, no
// routine prompt, no credential (decision T7: admins administer without
// reading private Directs). The one exception is the files routes
// (org-admin-files.ts, 2026-10-08: "access to all features of every bot,
// view their files"): a bot's files, for managers in reach and admins, each
// read and download written to the admin activity log.
import { MASCOT_CATALOG_FAMILIES, mascotCatalogue } from "../shared/mascot-catalog.ts";
import { permissionCatalogue } from "../shared/permissions.ts";
import type { IncomingMessage, ServerResponse } from "node:http";

import { aggregateOrgUsage, ORG_USAGE_MAX_ROWS, parseOrgUsageRange, type OrgUsageAggregate, type UsageRow } from "./usage-ledger.ts";
import type { ConsoleAssertion, ConsoleGrant, ConsoleGrantKind, OidcTeamClaim } from "./oidc-rp.ts";
import type { IdentifiedAdminAction } from "./admin-activity.ts";
import type { AdminBotLook, AdminBotPersona } from "./org-admin-look.ts";
import { ADMIN_FILES_ROUTE, answerBotFiles, type OrgAdminFilesDeps } from "./org-admin-files.ts";
import {
  compileRoutes,
  consoleLocale,
  enumParam,
  isAnswer,
  matchesQuery,
  matchRoutes,
  pageOf,
  parsePage,
  routeNames,
  type ConsoleAnswer,
  type ConsoleAuditEntry,
  type ConsoleContext,
  type ConsoleRoute,
} from "./org-admin-console.ts";

export const ORG_ADMIN_PREFIX = "/api/org/admin/";
export const ORG_ADMIN_JTI_MAX = 10_000;
/** A seen assertion id is kept until its exp plus this. */
export const ORG_ADMIN_JTI_GRACE_MS = 60_000;
export const ORG_ADMIN_MAX_BOTS = 2_000;
export const ORG_ADMIN_MAX_APPROVALS = 200;
const MAX_BODY_BYTES = 16 * 1024;
/** The version of this API `GET capabilities` reports: 1 was the nine first
 * routes, 2 the console routes of 2026-10-08, 3 the permission catalogue
 * of 2026-10-09 (`permissions`, `permissionGroups`, `permissionsVersion`),
 * 4 the engine list of the same day (`engines`), 5 the bots' look and
 * persona with the mascot catalogue of 2026-10-11 (`mascots`), 6 the bots'
 * `approvalMode` and the bulk `approvalMode` action of 2026-10-16. */
export const ORG_ADMIN_API_VERSION = 6;

/** One engine (model provider) of this server, as `GET capabilities` lists
 * it: grouped Cloud or Local as the model picker's provider column groups it
 * (src/lib/engine-rail.ts splitEngineRail), and how a person gets access. */
export interface AdminEngine {
  /** The engine instance id (`allowedEngines` takes these). */
  id: string;
  name: string;
  kind: "cloud" | "local";
  installed: boolean;
  /** `oauth`: a sign-in with the provider's account; `apiKey`: a key;
   * `none`: nothing to sign in to (a local server). */
  auth: "oauth" | "apiKey" | "none";
  /** 2026-10-16: the organization's key serves this engine (Settings >
   * Connections), never the key: a person sheet's `sagax_server_engines`
   * gives it to members. */
  orgKey?: boolean;
  /** The voice row (`xaiVoice`: voice mode, and read aloud and voice notes
   * when the voice engine is xAI): not a bot engine. */
  voice?: true;
  /** The media row (`xaiImage`): bot avatars and generated videos on the
   * organization's xAI key. Not a bot engine. */
  image?: true;
}
/** The built-in routes, as `GET capabilities` names them. */
const BUILT_IN_ROUTES: Array<Pick<ConsoleRoute, "method" | "path">> = [
  { method: "GET", path: "capabilities" },
  { method: "GET", path: "bots" },
  { method: "GET", path: "usage" },
  { method: "GET", path: "approvals" },
  { method: "POST", path: "approvals/{thread}/{request}" },
  { method: "GET", path: "audit" },
  { method: "GET", path: "files/{bot}/roots" },
  { method: "GET", path: "files/{bot}/list" },
  { method: "GET", path: "files/{bot}/stat" },
  { method: "GET", path: "files/{bot}/read" },
  { method: "GET", path: "files/{bot}/download" },
];
const MAX_TOKEN_CHARS = 8_192;
const CARD_ID = /^[A-Za-z0-9_-]{1,128}$/;
const AUDIT_CURSOR = /^\d{4}-\d{2}-\d{1,9}$/;

export type ConsoleRole = "admin" | "manager" | "employee";

/** A person as the console reads one. */
export interface AdminPerson {
  principalId: string;
  /** The Perspicax user id; null for a local or interim principal. */
  sub: string | null;
  name: string;
}

/** Who the assertion names, as the admin API sees them. */
export interface OrgAdminViewer {
  principalId: string;
  sub: string;
  name: string;
  role: ConsoleRole;
  orgAdmin: boolean;
  teams: OidcTeamClaim[];
}

export type AccessKind = "subscription" | "owner-key" | "speaker-key" | "org-key" | "server" | "none";

export interface AdminBot {
  id: string;
  name: string;
  owner: AdminPerson;
  ownerRole: "admin" | "member";
  engine: { instanceId: string; driverKind: string; installed: boolean };
  model: string | null;
  access: AccessKind;
  mcpProfiles: Array<{ id: string; name: string }>;
  grants: Array<{ target: string; kind: "user" | "team"; label: string; level: "use" | "run" | "edit" | "manage"; disabled?: true }>;
  sections: Array<{ id: string; name: string; defaultLevel: "use" | "run"; members: number }>;
  routines: number;
  createdAt: number | null;
  lastActivityAt: number | null;
  /** 2026-10-08: archived is Sagax's hidden bot (restored from the sidebar). */
  status: "active" | "archived";
  /** The sidebar label (section) the owner filed it under. */
  label: string | null;
  /** Its conversations: the main one plus every task. */
  threads: number;
  /** 2026-10-11: what it wears (server/org-admin-look.ts), for the console
   * to draw the mascot or show the picture. */
  look: AdminBotLook;
  /** 2026-10-11: the persona window's name, role and short description. */
  persona: AdminBotPersona;
  /** 2026-10-16: the bot's default approval level (ask, edits, auto, full,
   * custom), for the console's "Approve for me" bulk action. */
  approvalMode: string;
}

/** What a manager's reach is checked against for one bot. */
export interface AdminBotReach {
  ownerPrincipalId: string;
  /** `user:<pid>` / `team:<id>` of its grants. */
  grantTargets: string[];
  /** Member targets of the shared sections it sits in. */
  sectionMemberTargets: string[];
}

export type ApprovalType = "tool" | "skill" | "routine" | "profile" | "model" | "team_setup" | "tightening" | "peer" | "other";

export interface AdminApproval {
  botId: string;
  botName: string;
  threadId: string;
  requestId: string;
  kind: "owner" | "admin";
  type: ApprovalType;
  tool?: string;
  summary?: string;
  requestedBy?: AdminPerson;
  owner: AdminPerson;
  at: number;
  decidable: boolean;
  link: string;
}

export type ApprovalAnswer =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 404 | 409; code: "bad_request" | "not_found" | "card_not_pending" | "not_decidable" | "forbidden"; message: string };

export interface OrgAdminRouteDeps {
  /** Solo servers answer 403 identity_perspicax to everything here. */
  identity: "solo" | "perspicax";
  issuer: string;
  /** This server's public origin (SAGAX_PUBLIC_URL), the assertion audience. */
  publicOrigin(): string | null;
  /** The link file's server id, when a link is loaded. */
  linkServerId(): string | null;
  /** Throws (OidcError) on any failure. */
  verify(token: string, audienceOrigin: string, serverId: string | null): Promise<ConsoleAssertion>;
  /** The principal behind (issuer, sub). */
  principalFor(iss: string, sub: string): { id: string; name: string; disabled: boolean } | null;
  person(principalId: string): AdminPerson;
  /** Principal ids of the members and managers of these teams. */
  teamPeople(teamIds: readonly string[]): string[];
  bots(): Array<{ bot: AdminBot; reach: AdminBotReach }>;
  usageRows(range: { from: Date; to: Date }): UsageRow[];
  approvalsFor(viewer: OrgAdminViewer): AdminApproval[];
  answer(viewer: OrgAdminViewer, threadId: string, requestId: string, decision: "allow" | "deny"): Promise<ApprovalAnswer>;
  audit(input: { from?: number; to?: number; limit: number; before?: string | null; categories?: readonly string[]; target?: string }): { rows: IdentifiedAdminAction[]; next: string | null };
  /** The categories `GET audit?category=` accepts. */
  auditCategories?: readonly string[];
  /** The release people know (package.json forkVersion). */
  version?: () => string;
  /** The engines of this server, for the console's Model providers card. */
  engines?: () => AdminEngine[];
  /** The console routes of 2026-10-08 (server/org-admin-console.ts). */
  console?: readonly ConsoleRoute[];
  /** One admin activity row for a console write, actor the console person. */
  recordAction?: (principalId: string, entry: ConsoleAuditEntry) => void;
  /** The person rows of the audit actors (`nameOf`). */
  now?: () => number;
  /** A bot's files (read only, org-admin-files.ts) and what a manager's
   * reach is checked against for that bot; absent, every files path is 404. */
  files?: OrgAdminFilesDeps & { reach(botId: string): AdminBotReach | null };
}

/** Seen assertion ids: each kept until its exp plus a minute, pruned on each
 * call, at most 10,000 (the oldest goes first). In memory only: a restart
 * cannot replay a 60 s token beyond its life in practice. */
export class AssertionReplayCache {
  private readonly seen = new Map<string, number>();
  private readonly max: number;
  constructor(max = ORG_ADMIN_JTI_MAX) {
    this.max = max;
  }

  /** Records the id; false when it was already seen. */
  admit(jti: string, expMs: number, now: number): boolean {
    for (const [id, until] of this.seen) if (until <= now) this.seen.delete(id);
    if (this.seen.has(jti)) return false;
    while (this.seen.size >= this.max) {
      const oldest = this.seen.keys().next().value;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }
    this.seen.set(jti, expMs + ORG_ADMIN_JTI_GRACE_MS);
    return true;
  }

  size(): number {
    return this.seen.size;
  }
}


/** Whether an assertion's `grant` covers this one request: the kind the
 * route declares, the same method, the same path below /api/org/admin/. */
export function grantCovers(grant: ConsoleGrant | undefined, kind: ConsoleGrantKind, method: string, sub: string): boolean {
  return Boolean(grant && grant.kind === kind && grant.method === method && grant.path === sub);
}

/** The principals a manager reaches: themselves plus the members and
 * managers of every team their claim says they manage. Null for an admin
 * (everyone). */
export function managedReach(viewer: OrgAdminViewer, teamPeople: (teamIds: readonly string[]) => string[]): Set<string> | null {
  if (viewer.orgAdmin) return null;
  const managed = viewer.teams.filter((team) => team.manager).map((team) => team.id);
  return new Set([viewer.principalId, ...(managed.length ? teamPeople(managed) : [])]);
}

/** Whether a manager sees this bot: owner in reach, a grant to a managed
 * team or a person in reach, or a shared section with such a member. */
export function botInReach(reach: Set<string> | null, managedTeams: ReadonlySet<string>, facts: AdminBotReach): boolean {
  if (!reach) return true;
  if (reach.has(facts.ownerPrincipalId)) return true;
  const hits = (target: string) => {
    if (target.startsWith("team:")) return managedTeams.has(target.slice(5));
    if (target.startsWith("user:")) return reach.has(target.slice(5));
    return false;
  };
  return facts.grantTargets.some(hits) || facts.sectionMemberTargets.some(hits);
}

const textKey = (value: string) => value.toLocaleLowerCase();

/** Sorted by owner name then bot name, at most 2,000. */
export function sortAdminBots(bots: AdminBot[], max = ORG_ADMIN_MAX_BOTS): { bots: AdminBot[]; truncated: boolean } {
  const sorted = [...bots].sort((a, b) =>
    textKey(a.owner.name).localeCompare(textKey(b.owner.name)) || textKey(a.name).localeCompare(textKey(b.name)) || a.id.localeCompare(b.id));
  return { bots: sorted.slice(0, max), truncated: sorted.length > max };
}

/** One aggregated usage row as the console reads it. */
export function wireUsageRow(row: OrgUsageAggregate, person: (principalId: string) => AdminPerson) {
  const speaker = row.speaker.kind === "person"
    ? { kind: "person" as const, ...person(row.speaker.principalId) }
    : row.speaker.kind === "routine"
      ? { kind: "routine" as const, routineId: row.speaker.routineId, runAs: row.speaker.runAsPrincipalId ? person(row.speaker.runAsPrincipalId) : null }
      : row.speaker.kind === "bot"
        ? { kind: "bot" as const, botId: row.speaker.botId }
        : { kind: "unattributed" as const };
  return {
    day: row.day,
    botId: row.botId,
    botName: row.botName,
    owner: row.ownerPrincipalId ? person(row.ownerPrincipalId) : null,
    speaker,
    turns: row.turns,
    input: row.input,
    output: row.output,
    cachedInput: row.cachedInput,
    costUsd: row.costUsd,
    estimatedUsd: row.estimatedUsd,
    access: row.access,
    engine: row.engine,
  };
}

/** A session row (written before every Sagax change named the person by
 * principal id): the person when its user id is a known principal, else the
 * device label. Never the email: the console shows none in org mode. */
function sessionPerson(actor: { userId?: string; label: string }, person: (principalId: string) => AdminPerson): AdminPerson {
  if (actor.userId) {
    const known = person(actor.userId);
    if (known.name !== actor.userId) return known;
  }
  return { principalId: "", sub: null, name: actor.label.includes("@") ? "Signed-in user" : actor.label };
}

/** One audit row as the console reads it. */
export function wireAuditRow(row: IdentifiedAdminAction, person: (principalId: string) => AdminPerson) {
  const actor = row.actor.kind === "person"
    ? { kind: "person" as const, ...person(row.actor.principalId), via: row.actor.via }
    : row.actor.kind === "session"
      ? { kind: "person" as const, ...sessionPerson(row.actor, person), via: "sagax" as const }
      : row.actor.kind === "loopback"
        ? { kind: "local" as const }
        : { kind: row.actor.kind };
  return {
    id: row.id,
    at: Date.parse(row.at),
    category: row.category,
    action: row.action,
    actor,
    target: row.target ?? { kind: "server" },
    ...(row.changed ? { changed: row.changed } : {}),
    ...(row.before ? { before: row.before } : {}),
    ...(row.after ? { after: row.after } : {}),
  };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "x-sagax-admin-api": "1", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function refuse(res: ServerResponse, status: number, code: string, message: string): void {
  send(res, status, { code, message, reason: message, error: message });
}

async function answer(res: ServerResponse, reply: ConsoleAnswer): Promise<void> {
  if (reply.stream) {
    res.writeHead(reply.status, { "x-sagax-admin-api": "1", "cache-control": "no-store", ...reply.headers });
    try {
      await reply.stream((chunk) => new Promise<void>((resolve, reject) => {
        if (res.destroyed) { reject(new Error("The download was cancelled.")); return; }
        if (res.write(chunk)) resolve();
        else res.once("drain", resolve);
      }));
      res.end();
    } catch (error) {
      console.warn(`[org-admin] download stopped: ${error instanceof Error ? error.message : String(error)}`);
      res.destroy();
    }
    return;
  }
  if (reply.raw !== undefined) {
    res.writeHead(reply.status, { "x-sagax-admin-api": "1", "cache-control": "no-store", ...reply.headers });
    res.end(reply.raw);
    return;
  }
  for (const [name, value] of Object.entries(reply.headers ?? {})) res.setHeader(name, value);
  send(res, reply.status, reply.body);
}

function readSmallJson(req: IncomingMessage, max = MAX_BODY_BYTES): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      if (over) return;
      bytes += chunk.length;
      if (bytes > max) {
        over = true;
        resolve(undefined);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (over) return;
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) return resolve(null);
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve(undefined);
      }
    });
    req.on("error", () => resolve(undefined));
  });
}

const ROLE_RANK: Record<ConsoleRole, number> = { employee: 0, manager: 1, admin: 2 };

/** The handler: true when the request was one of ours (answered). */
export function createOrgAdminRoutes(deps: OrgAdminRouteDeps): (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean> {
  const replay = new AssertionReplayCache();
  const now = deps.now ?? Date.now;
  const consoleRoutes = compileRoutes(deps.console ?? []);
  const capabilities = routeNames([...BUILT_IN_ROUTES, ...(deps.console ?? [])]);
  return async (req, res, url) => {
    const path = url.pathname;
    if (path !== "/api/org/admin" && !path.startsWith(ORG_ADMIN_PREFIX)) return false;
    const method = req.method ?? "GET";
    if (deps.identity !== "perspicax") {
      refuse(res, 403, "identity_perspicax", "This server does not sign people in with Pulsatrix.");
      return true;
    }
    // The assertion is the only credential: cookies and loopback are ignored.
    const header = req.headers.authorization;
    const bearer = typeof header === "string" ? /^Bearer\s+(\S+)\s*$/i.exec(header)?.[1] : undefined;
    if (!bearer) {
      refuse(res, 401, "assertion_missing", "A console assertion is required.");
      return true;
    }
    const audience = deps.publicOrigin();
    if (!audience || bearer.length > MAX_TOKEN_CHARS) {
      refuse(res, 401, "assertion_invalid", audience ? "The console assertion is too long." : "This server has no public address to check the assertion against.");
      return true;
    }
    let assertion: ConsoleAssertion;
    try {
      assertion = await deps.verify(bearer, audience, deps.linkServerId());
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The console assertion does not verify.";
      refuse(res, 401, "assertion_invalid", reason.slice(0, 300));
      return true;
    }
    if (!replay.admit(assertion.jti, assertion.exp * 1000, now())) {
      refuse(res, 401, "assertion_replayed", "This console assertion was already used.");
      return true;
    }
    const principal = deps.principalFor(deps.issuer, assertion.sub);
    if (!principal) {
      refuse(res, 403, "unknown_person", "This person has not signed in to this server yet.");
      return true;
    }
    if (principal.disabled) {
      refuse(res, 403, "person_disabled", "This person is disabled on this server.");
      return true;
    }
    const viewer: OrgAdminViewer = {
      principalId: principal.id,
      sub: assertion.sub,
      name: principal.name,
      role: assertion.role,
      orgAdmin: assertion.role === "admin",
      teams: assertion.teams,
    };
    const sub = path.startsWith(ORG_ADMIN_PREFIX) ? path.slice(ORG_ADMIN_PREFIX.length) : "";
    const filesMatch = ADMIN_FILES_ROUTE.exec(sub);
    if (filesMatch) {
      if (!deps.files) {
        refuse(res, 404, "not_found", "No such admin route.");
        return true;
      }
      if (method !== "GET") {
        res.setHeader("allow", "GET");
        refuse(res, 405, "method_not_allowed", "Use GET here.");
        return true;
      }
      // Below manager, only the `own-bot` grant of this request, for a bot
      // of the person's own.
      const filesOwnOnly = ROLE_RANK[viewer.role] < ROLE_RANK.manager;
      if (filesOwnOnly && !grantCovers(assertion.grant, "own-bot", method, sub)) {
        refuse(res, 403, "forbidden_role", "This needs the manager role in Perspicax.");
        return true;
      }
      const botId = filesMatch[1]!;
      const facts = deps.files.reach(botId);
      const reach = managedReach(viewer, deps.teamPeople);
      const managedTeams = new Set(viewer.teams.filter((team) => team.manager).map((team) => team.id));
      // Out of a manager's reach reads as no such bot: the id says nothing.
      if (!facts || (filesOwnOnly ? facts.ownerPrincipalId !== viewer.principalId : !botInReach(reach, managedTeams, facts))) {
        refuse(res, 404, "not_found", "No such bot.");
        return true;
      }
      await answerBotFiles({
        req, res, url, botId,
        action: filesMatch[2] as "roots" | "list" | "stat" | "read" | "download",
        principalId: viewer.principalId,
        deps: deps.files,
        send,
      });
      return true;
    }
    const answerMatch = /^approvals\/([^/]+)\/([^/]+)$/.exec(sub);
    // `approvals?scope=org` and `approvals/history` are console routes.
    const consoleApprovals = sub === "approvals" && url.searchParams.get("scope") === "org";
    const route: { name: string; method: string; min: ConsoleRole; ownerGrant?: ConsoleGrantKind } | null = sub === "capabilities"
      ? { name: sub, method: "GET", min: "employee" as const }
      : (sub === "bots" || sub === "usage" || sub === "audit" || sub === "approvals") && !consoleApprovals
        ? { name: sub, method: "GET", min: sub === "audit" ? "admin" as const : sub === "approvals" ? "employee" as const : "manager" as const, ...(sub === "approvals" ? {} : { ownerGrant: "own-bot" as const }) }
        : answerMatch && answerMatch[1] !== "history" && CARD_ID.test(answerMatch[1]!) && CARD_ID.test(answerMatch[2]!)
          ? { name: "answer", method: "POST", min: "employee" as const }
          : null;
    if (!route) {
      const hits = matchRoutes(consoleRoutes, consoleApprovals ? "approvals?scope=org" : sub);
      if (!hits.length) {
        refuse(res, 404, "not_found", "No such admin route.");
        return true;
      }
      const hit = hits.find((candidate) => candidate.route.method === method);
      if (!hit) {
        const allowed = [...new Set(hits.map((candidate) => candidate.route.method))].join(", ");
        res.setHeader("allow", allowed);
        refuse(res, 405, "method_not_allowed", `Use ${allowed} here.`);
        return true;
      }
      // Below the route's role, only a grant bound to this very request lets
      // a person reach their own thing (2026-10-26, `own-computer`).
      let ownOnly = false;
      if (ROLE_RANK[viewer.role] < ROLE_RANK[hit.route.min]) {
        const granted = Boolean(hit.route.ownerGrant && grantCovers(assertion.grant, hit.route.ownerGrant, method, sub));
        if (!granted) {
          refuse(res, 403, "forbidden_role", `This needs the ${hit.route.min} role in Perspicax.`);
          return true;
        }
        ownOnly = true;
      }
      let body: unknown = null;
      const rawUpload = method === "POST" && hit.route.rawBody !== undefined && !/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""));
      if (rawUpload) {
        const declared = Number(req.headers["content-length"] ?? 0);
        if (Number.isFinite(declared) && declared > hit.route.rawBody!) {
          refuse(res, 413, "too_large", `The body is larger than ${hit.route.rawBody} bytes.`);
          return true;
        }
      } else if (method === "POST") {
        const declared = Number(req.headers["content-length"] ?? 0);
        const max = hit.route.maxBody ?? MAX_BODY_BYTES;
        if (Number.isFinite(declared) && declared > max) {
          refuse(res, 413, "too_large", `The body is larger than ${max} bytes.`);
          return true;
        }
        body = await readSmallJson(req, max);
        if (body === undefined) {
          refuse(res, 400, "bad_request", `The body is not JSON, or larger than ${max} bytes.`);
          return true;
        }
      }
      // Under a grant the reach is the person alone, and a bot is visible
      // only when it is theirs (not one shared with them).
      const reach = ownOnly ? new Set([viewer.principalId]) : managedReach(viewer, deps.teamPeople);
      const managedTeams = ownOnly ? new Set<string>() : new Set(viewer.teams.filter((team) => team.manager).map((team) => team.id));
      const ctx: ConsoleContext = {
        viewer,
        locale: consoleLocale(assertion.locale),
        url,
        params: hit.params,
        headers: req.headers,
        body,
        ...(rawUpload ? { request: req } : {}),
        reach,
        managedTeams,
        inReach: (principalId) => !reach || (principalId ? reach.has(principalId) : false),
        botVisible: (facts) => ownOnly ? facts.ownerPrincipalId === viewer.principalId : botInReach(reach, managedTeams, facts),
        record: (entry) => deps.recordAction?.(viewer.principalId, entry),
        now,
        ...(ownOnly ? { ownOnly: true } : {}),
      };
      try {
        await answer(res, await hit.route.handle(ctx));
      } catch (error) {
        const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 500;
        const message = status < 500 && error instanceof Error ? error.message.slice(0, 300) : "The server could not do this; its log has the details.";
        if (status >= 500) console.error(`[org-admin] ${method} ${sub}: ${error instanceof Error ? error.message : String(error)}`);
        const code = status < 500 ? (typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "refused") : "server_error";
        refuse(res, status, code, message);
      }
      return true;
    }
    if (method !== route.method) {
      res.setHeader("allow", route.method);
      refuse(res, 405, "method_not_allowed", `Use ${route.method} here.`);
      return true;
    }
    // Below the route's role: the `own-bot` grant of this request only, and
    // then the person's own bots alone.
    const ownOnly = ROLE_RANK[viewer.role] < ROLE_RANK[route.min];
    if (ownOnly && !(route.ownerGrant && grantCovers(assertion.grant, route.ownerGrant, method, sub))) {
      refuse(res, 403, "forbidden_role", `This needs the ${route.min} role in Perspicax.`);
      return true;
    }
    const reach = ownOnly ? new Set([viewer.principalId]) : managedReach(viewer, deps.teamPeople);
    const managedTeams = ownOnly ? new Set<string>() : new Set(viewer.teams.filter((team) => team.manager).map((team) => team.id));
    const inReach = (principalId: string | null | undefined) => !reach || (principalId ? reach.has(principalId) : false);
    const ownBot = (facts: AdminBotReach) => facts.ownerPrincipalId === viewer.principalId;

    if (route.name === "capabilities") {
      const catalogue = permissionCatalogue();
      send(res, 200, {
        version: deps.version?.() ?? "unknown",
        api: ORG_ADMIN_API_VERSION,
        routes: capabilities,
        // 2026-10-09: the permission catalogue Perspicax draws its matrix from.
        permissionsVersion: catalogue.version,
        permissionGroups: catalogue.groups,
        permissions: catalogue.permissions,
        // 2026-10-09 (api 4): the engines, so the console groups Cloud and
        // Local from the server instead of guessing from an id.
        ...(deps.engines ? { engines: deps.engines() } : {}),
        // 2026-10-11 (api 5): the characters a bot's `look` names, so the
        // console draws every one of them.
        mascotFamilies: [...MASCOT_CATALOG_FAMILIES],
        mascots: mascotCatalogue(),
      });
      return true;
    }
    if (route.name === "bots") {
      const listed = deps.bots().filter((entry) => ownOnly ? ownBot(entry.reach) : botInReach(reach, managedTeams, entry.reach)).map((entry) => entry.bot);
      const params = url.searchParams;
      const paged = ["q", "status", "engine", "owner", "limit", "cursor"].some((name) => params.has(name));
      if (!paged) {
        send(res, 200, sortAdminBots(listed));
        return true;
      }
      const page = parsePage(params);
      const status = enumParam(params, "status", ["active", "archived"] as const);
      if (isAnswer(page) || isAnswer(status)) {
        const reply = isAnswer(page) ? page : status as ConsoleAnswer;
        void answer(res, reply);
        return true;
      }
      const engine = params.get("engine") || null;
      const owner = params.get("owner") || null;
      const filtered = sortAdminBots(listed, Number.MAX_SAFE_INTEGER).bots.filter((bot) =>
        (!status || bot.status === status)
        && (!engine || bot.engine.instanceId === engine || bot.engine.driverKind === engine)
        && (!owner || bot.owner.principalId === owner || bot.owner.sub === owner)
        && matchesQuery(page.q, bot.name, bot.owner.name, bot.engine.instanceId, bot.model, bot.label));
      send(res, 200, pageOf(filtered, page));
      return true;
    }
    if (route.name === "usage") {
      const range = parseOrgUsageRange(url.searchParams.get("from"), url.searchParams.get("to"), new Date(now()));
      if (!range) {
        refuse(res, 400, "bad_request", "from and to are YYYY-MM-DD, from before to, at most 92 days.");
        return true;
      }
      const { rows, truncated } = aggregateOrgUsage(deps.usageRows(range), ({ speaker, ownerPrincipalId }) => {
        // Under the grant: the rows of the person's own bots.
        if (ownOnly) return ownerPrincipalId === viewer.principalId;
        if (!reach) return true;
        if (speaker.kind === "unattributed") return false;
        if (speaker.kind === "person" && inReach(speaker.principalId)) return true;
        if (speaker.kind === "routine" && inReach(speaker.runAsPrincipalId)) return true;
        return inReach(ownerPrincipalId);
      }, ORG_USAGE_MAX_ROWS);
      send(res, 200, { from: range.fromDay, to: range.toDay, rows: rows.map((row) => wireUsageRow(row, deps.person)), truncated });
      return true;
    }
    if (route.name === "approvals") {
      const approvals = deps.approvalsFor(viewer).sort((a, b) => a.at - b.at).slice(0, ORG_ADMIN_MAX_APPROVALS);
      send(res, 200, { approvals });
      return true;
    }
    if (route.name === "answer") {
      const body = await readSmallJson(req);
      const decision = body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 1
        ? (body as { decision?: unknown }).decision
        : undefined;
      if (decision !== "allow" && decision !== "deny") {
        refuse(res, 400, "bad_request", "Send { \"decision\": \"allow\" } or { \"decision\": \"deny\" }.");
        return true;
      }
      const outcome = await deps.answer(viewer, answerMatch![1]!, answerMatch![2]!, decision);
      if (!outcome.ok) {
        refuse(res, outcome.status, outcome.code, outcome.message);
        return true;
      }
      send(res, 200, { answered: true, decision });
      return true;
    }
    // audit (admin only, checked above)
    const params = url.searchParams;
    const int = (name: string) => {
      const value = params.get(name);
      if (value === null || value === "") return undefined;
      return /^\d{1,15}$/.test(value) ? Number(value) : Number.NaN;
    };
    const from = int("from");
    const to = int("to");
    const limitRaw = int("limit");
    const before = params.get("before");
    const limit = limitRaw ?? 200;
    if (Number.isNaN(from) || Number.isNaN(to) || Number.isNaN(limit) || limit < 1 || limit > 500 || (before !== null && before !== "" && !AUDIT_CURSOR.test(before)) || (from !== undefined && to !== undefined && from > to)) {
      refuse(res, 400, "bad_request", "from and to are milliseconds, limit 1 to 500, before an audit row id.");
      return true;
    }
    // 2026-10-08: one category, and the id of the target (a bot, a person).
    const category = params.get("category");
    const target = params.get("target");
    if (category && !(deps.auditCategories ?? []).includes(category)) {
      refuse(res, 400, "bad_request", `category is one of ${(deps.auditCategories ?? []).join(", ")}.`);
      return true;
    }
    if (target !== null && (target.length < 1 || target.length > 160)) {
      refuse(res, 400, "bad_request", "target is an id of at most 160 characters.");
      return true;
    }
    // Under the grant: the activity about one bot of the person's own.
    if (ownOnly && !(target && deps.bots().some((entry) => entry.bot.id === target && ownBot(entry.reach)))) {
      refuse(res, 404, "not_found", "No such bot.");
      return true;
    }
    const page = deps.audit({
      ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}), limit, before: before || null,
      ...(category ? { categories: [category] } : {}), ...(target ? { target } : {}),
    });
    send(res, 200, { rows: page.rows.map((row) => wireAuditRow(row, deps.person)), next: page.next });
    return true;
  };
}
