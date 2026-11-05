// Visible roles (2026-11-05): the person's routes for the roles their bots
// act as on Perspicax (shared/perspicax-roles.ts, server/perspicax/role-journal.ts).
//
//   POST   /api/bots/:id/cards/:messageId/role-transition  { threadId, choice }
//          an "Agit comme" card: continue | stay | always (owner only)
//   GET    /api/bots/:id/roles/rules            the owner's "Toujours ainsi" rules
//   DELETE /api/bots/:id/roles/rules            { id }
//
// Every handler is for the signed-in person only (the actor's principal):
// a rule is the bot owner's, a transition card is answered in a thread the
// person may write in (the deps check it), never across people.
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export type RoleTransitionChoice = "continue" | "stay" | "always";
export interface RoleRouteAnswer { status: number; body: unknown }

export interface PerspicaxRoleRouteDeps {
  /** The person behind the request (the local principal on a solo server). */
  actor(auth: RequestAuth): string | undefined;
  mayUseBot(auth: RequestAuth, botId: string): boolean;
  answerTransition(input: { botId: string; threadId: string; messageId: string; choice: RoleTransitionChoice; actor: string }): RoleRouteAnswer;
  rules(input: { botId: string; actor: string }): RoleRouteAnswer;
  removeRule(input: { botId: string; actor: string; id: string }): RoleRouteAnswer;
  /** Further role routes (picker, coverage, Roles tab): PASS when not theirs. */
  more?: (ctx: Parameters<RouteHandler>[0], input: { botId: string; rest: string; actor: string }) => Promise<typeof PASS | void>;
}

const CHOICES = new Set<RoleTransitionChoice>(["continue", "stay", "always"]);

export function createPerspicaxRoleRoutes(deps: PerspicaxRoleRouteDeps): RouteHandler {
  return async (ctx) => {
    const { req, res, path, method, json, readBody, auth } = ctx;
    const match = /^\/api\/bots\/([\w-]+)\/(cards\/[\w-]+\/role-transition|roles(?:\/[\w/-]*)?)$/.exec(path);
    if (!match) return PASS;
    const botId = match[1]!;
    const rest = match[2]!;
    const actor = deps.actor(auth);
    if (!actor || !deps.mayUseBot(auth, botId)) return json(res, 404, { error: "no such bot" });
    const card = /^cards\/([\w-]+)\/role-transition$/.exec(rest);
    if (card) {
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      const body = await readBody(req) as { threadId?: unknown; choice?: unknown } | null;
      const choice = body && typeof body.choice === "string" ? body.choice as RoleTransitionChoice : undefined;
      if (!body || typeof body.threadId !== "string" || !/^[\w-]+$/.test(body.threadId) || !choice || !CHOICES.has(choice)) {
        return json(res, 400, { error: "threadId and choice (continue, stay or always) are required" });
      }
      const answer = deps.answerTransition({ botId, threadId: body.threadId, messageId: card[1]!, choice, actor });
      return json(res, answer.status, answer.body);
    }
    if (rest === "roles/rules") {
      if (method === "GET") { const answer = deps.rules({ botId, actor }); return json(res, answer.status, answer.body); }
      if (method === "DELETE") {
        const body = await readBody(req) as { id?: unknown } | null;
        if (!body || typeof body.id !== "string" || !body.id) return json(res, 400, { error: "id is required" });
        const answer = deps.removeRule({ botId, actor, id: body.id });
        return json(res, answer.status, answer.body);
      }
      return json(res, 405, { error: "method not allowed" });
    }
    if (deps.more) return deps.more(ctx, { botId, rest, actor });
    return PASS;
  };
}
