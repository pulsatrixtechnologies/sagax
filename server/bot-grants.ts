// A bot's grants on an organization server (slice 4):
//
//   GET    /api/bots/:id/grants          the grants the caller may administer,
//                                        and what they may give
//   PUT    /api/bots/:id/grants          { target, level }: add or change one
//   DELETE /api/bots/:id/grants/:target  remove one (target URL-encoded)
//
// A target is `user:<principal id>` or `team:<Perspicax team id>`; a level is
// use, run, edit or manage (server/auth/authz.ts). Who may administer: the owner,
// manage holders (up to edit), organization admins, and team managers for
// their teams and members under the anchor rule (decision D4).
//
// The slice 3 routes POST /api/bots/:id/direct-grants and DELETE
// .../direct-grants/:principalId stay (server/auth/direct-grants.ts): a user
// target at level use, for the owner.
import {
  canAdministerGrant,
  canOnBot,
  grantAdministration,
  isLevel,
  levelRank,
  managerReaches,
  parseTarget,
  type BotFacts,
  type BotGrant,
  type Level,
  type TeamRef,
  type Viewer,
} from "./auth/authz.ts";
import type { RequestAuth } from "./auth/request-auth.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

export interface GrantedBot {
  id: string;
  grants: BotGrant[];
}

export interface WireGrant extends BotGrant {
  label: string;
  kind: "user" | "team";
  disabled?: boolean;
}

export interface BotGrantRouteDeps {
  /** The bot with its current grants, or undefined. */
  bot(id: string): GrantedBot | undefined;
  /** Owner, grants and shared sections, for authz. */
  facts(botId: string): BotFacts;
  viewer(auth: RequestAuth): Viewer | undefined;
  teamsOf(principalId: string): readonly TeamRef[];
  /** A person a grant may name (an active directory person). */
  resolvePerson(ref: string): { ok: true; id: string } | { ok: false; code: "unknown_person" };
  teamKnown(teamId: string): boolean;
  /** A display label for a target, and whether that person is disabled. */
  describe(target: string): { label: string; disabled?: boolean };
  setGrants(botId: string, grants: BotGrant[]): void;
  /** After a change was saved: widen or narrow at once (member refresh). */
  onChanged(botId: string): void;
  /** Slice 7: one audit row per change that was saved (category rights). */
  audit?(auth: RequestAuth, row: GrantAuditRow): void;
  /** 2026-10-09: the refusal for a caller whose profile lacks
   * sharing.grants (null: allowed). Checked before any write. */
  shareRefusal?(auth: RequestAuth): Record<string, unknown> | null;
  now?: () => number;
}

/** A rights change for the admin activity log (slice 7). */
export interface GrantAuditRow {
  action: "grant.set" | "grant.remove" | "direct_grant.add" | "direct_grant.remove";
  botId: string;
  before?: { target: string; level: Level } | null;
  after?: { target: string; level: Level } | null;
}

/** The grants as the wire carries them, with labels. */
export function wireGrants(grants: readonly BotGrant[], describe: BotGrantRouteDeps["describe"]): WireGrant[] {
  return grants.map((grant) => {
    const described = describe(grant.target);
    return {
      ...grant,
      kind: grant.target.startsWith("team:") ? "team" as const : "user" as const,
      label: described.label,
      ...(described.disabled ? { disabled: true } : {}),
    };
  });
}

/** The grants this viewer may see in the editor: every grant for those who
 * administer any target, else the ones reaching their teams. */
export function visibleGrants(viewer: Viewer | undefined, facts: BotFacts, teamsOf: BotGrantRouteDeps["teamsOf"]): BotGrant[] | null {
  const administer = grantAdministration(viewer, facts);
  if (!administer) return null;
  if (administer.any) return [...facts.grants];
  const reached = facts.grants.filter((grant) => managerReaches(viewer!, grant.target, teamsOf));
  return reached.length ? reached : null;
}

export function createBotGrantRoutes(deps: BotGrantRouteDeps): RouteHandler {
  const now = deps.now ?? Date.now;
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const one = path.match(/^\/api\/bots\/([\w-]+)\/grants\/([^/]+)$/);
    const all = one ? null : path.match(/^\/api\/bots\/([\w-]+)\/grants$/);
    if (!one && !all) return PASS;
    const botId = (one ?? all)![1]!;
    const viewer = deps.viewer(auth);
    const reply = (status: number, body: unknown) => json(res, status, body);
    const answer = (grants: readonly BotGrant[]) => {
      res.setHeader("cache-control", "no-store");
      const facts = deps.facts(botId);
      const shown = visibleGrants(viewer, { ...facts, grants: [...grants] }, deps.teamsOf) ?? [];
      return reply(200, { grants: wireGrants(shown, deps.describe) });
    };

    if (all && method === "GET") {
      const bot = deps.bot(botId);
      if (!bot) return reply(404, { error: "no such bot" });
      const facts = deps.facts(botId);
      const administer = grantAdministration(viewer, facts);
      const shown = visibleGrants(viewer, facts, deps.teamsOf);
      // A manager whose teams the bot never reached learns nothing of it.
      if (!administer || (!administer.any && !shown && !canOnBot(viewer, "bot.use", facts))) {
        return reply(403, { error: "you may not administer this bot's sharing", code: "not_allowed" });
      }
      res.setHeader("cache-control", "no-store");
      // 2026-10-09: a caller whose profile lacks sharing.grants reads the
      // grants without the editor (administer null).
      return reply(200, { grants: wireGrants(shown ?? [], deps.describe), administer: deps.shareRefusal?.(auth) ? null : administer });
    }

    if ((all && method === "PUT") || (one && method === "DELETE")) {
      const refused = deps.shareRefusal?.(auth);
      if (refused) return reply(403, refused);
    }

    if (all && method === "PUT") {
      const body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) return reply(400, { error: "send { target, level }", code: "bad_target" });
      const target = typeof body.target === "string" ? body.target.trim() : "";
      const parsed = target.length <= 80 ? parseTarget(target) : null;
      if (!parsed) return reply(400, { error: "target must be user:<principal id> or team:<team id>", code: "bad_target" });
      if (!isLevel(body.level)) return reply(400, { error: "level must be use, run, edit or manage", code: "bad_level" });
      const level: Level = body.level;
      const bot = deps.bot(botId);
      if (!bot) return reply(404, { error: "no such bot" });
      const facts = deps.facts(botId);
      if (parsed.kind === "user" && parsed.id === facts.ownerPrincipalId) return reply(400, { error: "the owner already has every right", code: "self" });
      // Authorize before resolving anyone: nothing is looked up for a caller
      // who may not touch this grant.
      if (!canAdministerGrant(viewer, { bot: facts, target, newLevel: level, teamsOf: deps.teamsOf })) {
        return reply(403, { error: "you may not give this grant", code: "not_allowed" });
      }
      let finalTarget = target;
      if (parsed.kind === "user") {
        const person = deps.resolvePerson(parsed.id);
        if (!person.ok) return reply(400, { error: "choose an active person from the organization directory", code: person.code });
        if (person.id === facts.ownerPrincipalId) return reply(400, { error: "the owner already has every right", code: "self" });
        finalTarget = `user:${person.id}`;
      } else if (!deps.teamKnown(parsed.id)) {
        return reply(400, { error: "choose a team from the organization directory", code: "unknown_team" });
      }
      const current = bot.grants.find((grant) => grant.target === finalTarget);
      const by = viewer?.principalId ?? facts.ownerPrincipalId;
      const next: BotGrant[] = current
        ? bot.grants.map((grant) => grant.target !== finalTarget ? grant : levelRank(level) < levelRank(grant.level)
          // Lowering keeps who gave it (a manager's anchor stays someone else's).
          ? { ...grant, level }
          : { target: finalTarget, level, by, at: now() })
        : [...bot.grants, { target: finalTarget, level, by, at: now() }];
      if (!current || current.level !== level) {
        deps.setGrants(botId, next);
        console.log(`[grants] bot ${botId}: ${parsed.kind} grant set to ${level}`);
        deps.onChanged(botId);
        deps.audit?.(auth, { action: "grant.set", botId, before: current ? { target: finalTarget, level: current.level } : null, after: { target: finalTarget, level } });
      }
      return answer(deps.bot(botId)?.grants ?? next);
    }

    if (one && method === "DELETE") {
      let target: string;
      try {
        target = decodeURIComponent(one[2]!);
      } catch {
        return reply(400, { error: "target must be user:<principal id> or team:<team id>", code: "bad_target" });
      }
      if (!parseTarget(target)) return reply(400, { error: "target must be user:<principal id> or team:<team id>", code: "bad_target" });
      const bot = deps.bot(botId);
      if (!bot) return reply(404, { error: "no such bot" });
      const facts = deps.facts(botId);
      if (!bot.grants.some((grant) => grant.target === target)) {
        // Say "absent" only to someone who may administer that target.
        const allowed = canAdministerGrant(viewer, { bot: { ...facts, grants: [...facts.grants, { target, level: "use", by: "", at: 0 }] }, target, teamsOf: deps.teamsOf });
        return allowed ? reply(404, { error: "no such grant" }) : reply(403, { error: "you may not remove this grant", code: "not_allowed" });
      }
      if (!canAdministerGrant(viewer, { bot: facts, target, teamsOf: deps.teamsOf })) {
        return reply(403, { error: "you may not remove this grant", code: "not_allowed" });
      }
      const removed = bot.grants.find((grant) => grant.target === target);
      const next = bot.grants.filter((grant) => grant.target !== target);
      deps.setGrants(botId, next);
      console.log(`[grants] bot ${botId}: ${target.startsWith("team:") ? "team" : "user"} grant removed`);
      deps.onChanged(botId);
      deps.audit?.(auth, { action: "grant.remove", botId, before: removed ? { target, level: removed.level } : null, after: null });
      return answer(deps.bot(botId)?.grants ?? next);
    }

    return reply(405, { error: "method not allowed" });
  };
}
