/**
 * POST and DELETE /api/bots/:id/primary (#1388 B1).
 * Own match scratch. Never imports server/index.ts.
 */
import type { BotsCoreRouteDeps } from "./bots-core-deps.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createBotsCorePrimaryRoutes(deps: BotsCoreRouteDeps): RouteHandler {
  return async ({ res, path, method, auth, json }) => {
    const {
      store,
      wireBot,
      actorPrincipalId,
      effectiveBotOwner,
    } = deps;
    const IDENTITY = deps.identity;
    let m: RegExpMatchArray | null = null;

    m = path.match(/^\/api\/bots\/([\w-]+)\/primary$/);
    if (m && method === "POST") {
      const target = store.bot(m[1]);
      if (!target) return json(res, 404, { error: "no such bot" });
      const actor = actorPrincipalId(auth).trim().toLowerCase();
      const owner = effectiveBotOwner(target);
      const soloAdmin = IDENTITY.kind !== "perspicax" && (auth.kind !== "session" || auth.scopes.includes("admin"));
      if (!soloAdmin && (!actor || owner !== actor)) {
        return json(res, 403, { error: "Only this bot's owner can make it their Primary Bot", code: "not_bot_owner" });
      }
      const changed = store.setPrimaryBot(target.id);
      if (changed === null) return json(res, 404, { error: "no such bot" });
      return json(res, 200, { bot: wireBot(store.bot(target.id)!), changed: changed.map((bot) => bot.id) });
    }
    // Leave the role. The same people who may take it may give it up. A
    // member cannot PATCH chiefOfStaff (it is not a member field), so this
    // is the step-down that matches POST.
    if (m && method === "DELETE") {
      const target = store.bot(m[1]);
      if (!target) return json(res, 404, { error: "no such bot" });
      const actor = actorPrincipalId(auth).trim().toLowerCase();
      const owner = effectiveBotOwner(target);
      const soloAdmin = IDENTITY.kind !== "perspicax" && (auth.kind !== "session" || auth.scopes.includes("admin"));
      if (!soloAdmin && (!actor || owner !== actor)) {
        return json(res, 403, { error: "Only this bot's owner can step down their Primary Bot", code: "not_bot_owner" });
      }
      const changed = store.clearPrimaryBot(target.id);
      if (changed === null) return json(res, 404, { error: "no such bot" });
      return json(res, 200, { bot: wireBot(store.bot(target.id)!), changed: changed.map((bot) => bot.id) });
    }
    return PASS;
  };
}
