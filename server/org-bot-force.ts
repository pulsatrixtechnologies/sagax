// Admin force actions on any bot of an organization server
// (Settings > Organization > Sharing in the organization):
//
//   POST /api/org/bots/<id>/force-stop     interrupt every running turn,
//                                          task and routine run of the bot
//   POST /api/org/bots/<id>/force-delete   { confirm: "<bot name>" }: stop,
//                                          then delete the bot
//
// An organization admin only (`isAdmin`: the operator at this computer or a
// person whose Perspicax role is admin), even on a bot they cannot open
// otherwise. Both are audited; the owner is told (a notification to them
// alone) when someone else acted. A solo server answers 403
// `identity_perspicax`. The routes are admin scope (never in CLIENT_ALLOW).
import type { RequestAuth } from "./request-auth.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

export interface ForceBot {
  id: string;
  name: string;
  ownerPrincipalId: string;
}

export interface OrgBotForceDeps {
  /** An organization server (`SAGAX_IDENTITY=perspicax`). */
  organization: boolean;
  isAdmin(auth: RequestAuth): boolean;
  /** 2026-10-19: whether this caller may act on what this person owns (a
   * person an admin gave people.manage never acts on an admin's). Absent:
   * yes. */
  mayActOn?(auth: RequestAuth, ownerPrincipalId: string): boolean;
  bot(id: string): ForceBot | null;
  /** The principal of the caller (the operator's own at this computer). */
  actorId(auth: RequestAuth): string;
  /** Interrupt every running turn, task and routine run of the bot. */
  stop(botId: string): Promise<void>;
  /** Delete the bot after it was stopped: its status and body. */
  remove(botId: string): Promise<{ status: number; body: { ok?: boolean; error?: string } }>;
  audit(auth: RequestAuth, action: "bot.force_stop" | "bot.force_delete", bot: ForceBot): void;
  /** Tell the owner, to them alone. */
  notifyOwner(bot: ForceBot, action: "stop" | "delete", auth: RequestAuth): void;
}

const FORCE = /^\/api\/org\/bots\/([\w-]{1,80})\/(force-stop|force-delete)$/;

export function createOrgBotForceRoutes(deps: OrgBotForceDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const match = FORCE.exec(path);
    if (!match) return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (!deps.organization) {
      return json(res, 403, { error: "Force actions exist on an organization server only.", code: "identity_perspicax" });
    }
    if (!deps.isAdmin(auth)) {
      return json(res, 403, { error: "Only an organization admin can force this.", code: "not_org_admin" });
    }
    const bot = deps.bot(match[1]!);
    if (!bot) return json(res, 404, { error: "no such bot" });
    if (deps.mayActOn && !deps.mayActOn(auth, bot.ownerPrincipalId)) {
      return json(res, 403, { error: "Only an organization admin can act on an admin's bot.", code: "target_is_admin" });
    }
    const action = match[2] === "force-stop" ? "stop" : "delete";
    if (action === "delete") {
      const body = await readBody(req).catch(() => null) as { confirm?: unknown } | null;
      // The dialog names the bot; the server checks the admin typed or
      // confirmed that same bot, so a stale list never deletes another one.
      if (!body || typeof body !== "object" || body.confirm !== bot.name) {
        return json(res, 400, { error: "send { confirm: \"<bot name>\" }", code: "confirm_required" });
      }
    }
    try {
      await deps.stop(bot.id);
    } catch (error) {
      if (action === "stop") return json(res, 500, { error: `the bot could not be stopped: ${error instanceof Error ? error.message : String(error)}` });
      // A delete still tries: the lifecycle refuses if work is left.
    }
    if (action === "stop") {
      deps.audit(auth, "bot.force_stop", bot);
      if (bot.ownerPrincipalId !== deps.actorId(auth)) deps.notifyOwner(bot, "stop", auth);
      return json(res, 200, { ok: true, stopped: bot.id });
    }
    const removed = await deps.remove(bot.id);
    if (removed.status !== 200) return json(res, removed.status, removed.body);
    deps.audit(auth, "bot.force_delete", bot);
    if (bot.ownerPrincipalId !== deps.actorId(auth)) deps.notifyOwner(bot, "delete", auth);
    return json(res, 200, { ok: true, deleted: bot.id });
  };
}
