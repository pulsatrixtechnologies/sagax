// People (console design 4.2 and section 5): every person of the
// organization as Sagax knows them, a person's page, and the admin actions
// Disable or Enable, Reset access, revoke a connection, and pause or resume
// every routine that runs as the person (2026-10-11). Metadata only: never a
// token, a key value, a message or an instruction.
import type { RemovedConnection } from "./org-person-connections.ts";
import type { AdminBot, AdminBotReach, AdminPerson } from "./org-admin-routes.ts";
import {
  badRequest,
  enumParam,
  fail,
  isAnswer,
  matchesQuery,
  notFound,
  objectBody,
  ok,
  onlyKeys,
  pageOf,
  parsePage,
  type ConsoleContext,
  type ConsoleRoute,
} from "./org-admin-console.ts";
import type { UsageRow } from "./usage-ledger.ts";

const DAY_MS = 24 * 60 * 60_000;
export type EngineVia = "subscription" | "key" | "org-key" | "none";
export type PresenceState = "online" | "idle" | "away" | "offline";

export interface PersonFacts {
  principalId: string;
  sub: string | null;
  name: string;
  role: "admin" | "member";
  /** Out in Perspicax (disabled, deleted, signed out by the provider). */
  perspicaxDisabled: boolean;
  /** Turned off in this Sagax from the console. */
  consoleDisabled: { at: number; by: string; reason?: string } | null;
  presence: { state: PresenceState; lastSeenAt: number | null };
  engines: Array<{ id: string; via: EngineVia }>;
}

export interface PersonConnections {
  engines: Array<{ id: string; via: EngineVia; signedIn: boolean; key: boolean }>;
  mcpServers: Array<{ id: string; name: string; transport: "remote" | "stdio"; state: "enabled" | "disabled" | "paused" }>;
}

export interface PeopleDeps {
  people(): PersonFacts[];
  person(principalId: string): AdminPerson;
  bots(): Array<{ bot: AdminBot; reach: AdminBotReach }>;
  /** Every routine with the person it runs as (its runAs, else its bot's
   * owner) and whether it is active. */
  routines(): Array<{ id: string; name: string; botId: string; runAs: string | null; enabled?: boolean }>;
  /** 2026-10-11: turn one routine on or off, as POST routines/{id}/pause
   * does; false when it is gone. */
  setRoutineEnabled?(routineId: string, enabled: boolean, actorPrincipalId: string): boolean;
  usageRows(range: { from: Date; to: Date }): UsageRow[];
  /** Bots shared with this person, and how. */
  shared(principalId: string): Array<{ botId: string; botName: string; level: string; via: "user" | "team" | "section" }>;
  connections(principalId: string): PersonConnections;
  /** Turns the person off (a value) or back on (null) in this server; the
   * caller stops their sessions on Disable. */
  setDisabled(principalId: string, value: { at: number; by: string; reason?: string } | null): void;
  resetAccess(principalId: string, scope: "engine-logins" | "sessions" | "all"): Promise<{ engineLogins: number; sessions: number }>;
  revokeConnections(principalId: string, body: unknown): Promise<{ status: number; body: Record<string, unknown>; removed: RemovedConnection[] }>;
  /** The listing the session route answers, after a revoke. */
  connectionListing(principalId: string): unknown;
  /** 2026-10-09: the person's effective permissions (server/org-permissions.ts). */
  permissions?(principalId: string): PersonPermissions;
}

/** What GET people/{principal} says of a person's permissions. */
export interface PersonPermissions {
  /** admin (every key), perspicax (the union over their profiles) or
   * defaults (Perspicax sent no list: the member defaults). */
  source: "admin" | "perspicax" | "defaults";
  /** The keys they hold, in catalogue order. */
  effective: string[];
  /** Person sheet narrowings applied on top. */
  narrowedBy: string[];
}

export interface PersonRow {
  principalId: string;
  sub: string | null;
  name: string;
  role: "admin" | "member";
  disabled: boolean;
  disabledBy: "perspicax" | "sagax" | null;
  presence: { state: PresenceState; lastSeenAt: number | null };
  bots: number;
  routines: number;
  lastTurnAt: number | null;
  turns30d: number;
  costUsd30d: number | null;
  engines: Array<{ id: string; via: EngineVia }>;
}

/** Turns of the last 30 days by the person who spoke (a routine counts for
 * the person it ran as). */
export function usageByPerson(rows: readonly UsageRow[]): Map<string, { turns: number; costUsd: number | null; lastAt: number }> {
  const out = new Map<string, { turns: number; costUsd: number | null; lastAt: number }>();
  for (const row of rows) {
    const trigger = row.trigger;
    const principalId = trigger.kind === "user" ? trigger.principalId : trigger.kind === "routine" ? trigger.runAsPrincipalId : undefined;
    if (!principalId) continue;
    const entry = out.get(principalId) ?? { turns: 0, costUsd: null, lastAt: 0 };
    entry.turns += 1;
    if (typeof row.costUsd === "number" && Number.isFinite(row.costUsd)) entry.costUsd = (entry.costUsd ?? 0) + row.costUsd;
    entry.lastAt = Math.max(entry.lastAt, Date.parse(row.at) || 0);
    out.set(principalId, entry);
  }
  return out;
}

export function personRows(deps: Pick<PeopleDeps, "people" | "bots" | "routines" | "usageRows">, now: number): PersonRow[] {
  const disabledBy = (person: PersonFacts): PersonRow["disabledBy"] => person.perspicaxDisabled ? "perspicax" : person.consoleDisabled ? "sagax" : null;
  const owned = new Map<string, number>();
  for (const { bot } of deps.bots()) owned.set(bot.owner.principalId, (owned.get(bot.owner.principalId) ?? 0) + 1);
  const runs = new Map<string, number>();
  for (const routine of deps.routines()) if (routine.runAs) runs.set(routine.runAs, (runs.get(routine.runAs) ?? 0) + 1);
  const usage = usageByPerson(deps.usageRows({ from: new Date(now - 30 * DAY_MS), to: new Date(now) }));
  return deps.people().map((person): PersonRow => {
    const used = usage.get(person.principalId);
    return {
      principalId: person.principalId,
      sub: person.sub,
      name: person.name,
      role: person.role,
      disabled: person.perspicaxDisabled || Boolean(person.consoleDisabled),
      disabledBy: disabledBy(person),
      presence: person.presence,
      bots: owned.get(person.principalId) ?? 0,
      routines: runs.get(person.principalId) ?? 0,
      lastTurnAt: used?.lastAt || null,
      turns30d: used?.turns ?? 0,
      costUsd30d: used?.costUsd ?? null,
      engines: person.engines,
    };
  }).sort((a, b) => a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()) || a.principalId.localeCompare(b.principalId));
}

function findRow(ctx: ConsoleContext, deps: PeopleDeps, principalId: string): PersonRow | null {
  if (!ctx.inReach(principalId)) return null;
  return personRows(deps, ctx.now()).find((row) => row.principalId === principalId) ?? null;
}

export function peopleRoutes(deps: PeopleDeps): ConsoleRoute[] {
  return [
    {
      method: "GET",
      path: "people",
      min: "manager",
      handle(ctx) {
        const params = ctx.url.searchParams;
        const page = parsePage(params);
        if (isAnswer(page)) return page;
        const role = enumParam(params, "role", ["admin", "member"] as const);
        if (isAnswer(role)) return role;
        const presence = enumParam(params, "presence", ["online", "idle", "away", "offline"] as const);
        if (isAnswer(presence)) return presence;
        const disabled = enumParam(params, "disabled", ["true", "false"] as const);
        if (isAnswer(disabled)) return disabled;
        const rows = personRows(deps, ctx.now()).filter((row) => ctx.inReach(row.principalId)
          && (!role || row.role === role)
          && (!presence || row.presence.state === presence)
          && (!disabled || row.disabled === (disabled === "true"))
          && matchesQuery(page.q, row.name, row.sub));
        return ok(pageOf(rows, page));
      },
    },
    {
      method: "GET",
      path: "people/{principal}",
      min: "manager",
      handle(ctx) {
        const principalId = ctx.params.principal!;
        const row = findRow(ctx, deps, principalId);
        if (!row) return notFound("No such person.");
        const bots = deps.bots().filter((entry) => entry.bot.owner.principalId === principalId && ctx.botVisible(entry.reach)).map((entry) => entry.bot);
        return ok({
          ...row,
          bots,
          shared: deps.shared(principalId),
          connections: deps.connections(principalId),
          routinesAsRunner: deps.routines().filter((routine) => routine.runAs === principalId).map(({ id, name, botId }) => ({ id, name, botId })),
          ...(deps.permissions ? { permissions: deps.permissions(principalId) } : {}),
        });
      },
    },
    {
      method: "POST",
      path: "people/{principal}/disable",
      min: "admin",
      handle(ctx) {
        const principalId = ctx.params.principal!;
        const body = objectBody(ctx.body);
        const extra = body ? onlyKeys(body, ["disabled", "reason"]) : null;
        if (!body || extra || typeof body.disabled !== "boolean" || (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 500))) {
          return badRequest(extra ?? "Send { \"disabled\": true or false, \"reason\"?: text of at most 500 characters }.");
        }
        if (principalId === ctx.viewer.principalId) return fail(409, "self", "You cannot disable yourself.");
        const before = findRow(ctx, deps, principalId);
        if (!before) return notFound("No such person.");
        const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : undefined;
        deps.setDisabled(principalId, body.disabled ? { at: ctx.now(), by: ctx.viewer.principalId, ...(reason ? { reason } : {}) } : null);
        ctx.record({
          category: "people", action: body.disabled ? "person.console_disable" : "person.console_enable",
          target: { kind: "person", id: principalId, name: before.name }, changed: ["disabled"],
          before: { disabled: before.disabledBy === "sagax" }, after: { disabled: body.disabled, ...(reason ? { reason } : {}) },
        });
        return ok({ person: findRow(ctx, deps, principalId) });
      },
    },
    {
      method: "POST",
      path: "people/{principal}/reset-access",
      min: "admin",
      async handle(ctx) {
        const principalId = ctx.params.principal!;
        const body = objectBody(ctx.body);
        const scope = body?.scope;
        if (!body || onlyKeys(body, ["scope"]) || (scope !== "engine-logins" && scope !== "sessions" && scope !== "all")) {
          return badRequest("Send { \"scope\": \"engine-logins\", \"sessions\" or \"all\" }.");
        }
        const person = findRow(ctx, deps, principalId);
        if (!person) return notFound("No such person.");
        const cleared = await deps.resetAccess(principalId, scope);
        ctx.record({ category: "people", action: "person.reset_access", target: { kind: "person", id: principalId, name: person.name }, after: { scope, ...cleared } });
        return ok({ person: findRow(ctx, deps, principalId), cleared });
      },
    },
    ...(deps.setRoutineEnabled ? (["pause", "resume"] as const).map((verb): ConsoleRoute => ({
      method: "POST",
      path: `people/{principal}/routines/${verb}`,
      min: "admin",
      handle(ctx) {
        const principalId = ctx.params.principal!;
        const body = ctx.body === undefined || ctx.body === null ? {} : objectBody(ctx.body);
        if (!body || Object.keys(body).length) return badRequest("Send {} (no fields).");
        const person = findRow(ctx, deps, principalId);
        if (!person) return notFound("No such person.");
        const enabled = verb === "resume";
        const theirs = deps.routines().filter((routine) => routine.runAs === principalId);
        const changed: string[] = [];
        for (const routine of theirs) {
          if ((routine.enabled !== false) === enabled) continue;
          if (deps.setRoutineEnabled!(routine.id, enabled, ctx.viewer.principalId)) changed.push(routine.id);
        }
        // One row for the whole action, naming every routine it moved.
        if (changed.length) {
          ctx.record({
            category: "people", action: enabled ? "person.routines_resume" : "person.routines_pause",
            target: { kind: "person", id: principalId, name: person.name }, changed: ["enabled"],
            before: { enabled: !enabled }, after: { enabled, routines: changed },
          });
        }
        const now = new Set(theirs.map((routine) => routine.id));
        return ok({
          person: findRow(ctx, deps, principalId),
          changed: changed.length,
          routines: deps.routines().filter((routine) => now.has(routine.id)).map(({ id, name, botId, enabled: on }) => ({ id, name, botId, enabled: on !== false })),
        });
      },
    })) : []),
    {
      method: "POST",
      path: "people/{principal}/connections/revoke",
      min: "admin",
      async handle(ctx) {
        const principalId = ctx.params.principal!;
        const person = findRow(ctx, deps, principalId);
        if (!person) return notFound("No such person.");
        const outcome = await deps.revokeConnections(principalId, ctx.body);
        if (outcome.removed.length) {
          ctx.record({ category: "people", action: "connections.revoke", target: { kind: "person", id: principalId, name: person.name }, after: { removed: outcome.removed } });
        }
        if (outcome.status !== 200) {
          const message = typeof outcome.body.error === "string" ? outcome.body.error : "The connection could not be removed.";
          const code = typeof outcome.body.code === "string" ? outcome.body.code === "invalid_body" ? "bad_request" : outcome.body.code : "server_error";
          return fail(outcome.status, code, message);
        }
        return ok({ removed: outcome.removed, connections: deps.connectionListing(principalId) });
      },
    },
  ];
}
