/**
 * Project folder order, create, patch and delete (#1388 B1).
 * Own match scratch. /projects/order stays ahead of /projects/:id.
 * Never imports server/index.ts.
 */
import { parseFolderBody, parseFolderOrder } from "../threads/thread-folders.ts";

import type { BotsCoreRouteDeps } from "./bots-core-deps.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createBotsCoreProjectsRoutes(deps: BotsCoreRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const {
      store,
      viewerForApproval,
      projectBotTranscript,
      publicBot,
      ownerOrAdminOf,
    } = deps;
    let m: RegExpMatchArray | null = null;

    m = path.match(/^\/api\/bots\/([\w-]+)\/projects\/order$/);
    if (m && method === "PATCH") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      // A client session organizes the folders of a bot it owns (its own
      // threads), never another person's bot.
      if (!ownerOrAdminOf(auth, bot)) return json(res, 403, { error: "forbidden: only the bot owner or an admin can organize its folders", code: "bot_folders_owner_only" });
      const order = parseFolderOrder(await readBody(req));
      if (!order.ok) return json(res, 400, { error: order.error });
      const projects = store.reorderProjects(bot.id, order.projectIds);
      if (!projects) return json(res, 400, { error: "projectIds must include each of this bot's folders exactly once" });
      return json(res, 200, { projects, bot: projectBotTranscript(publicBot(bot), viewerForApproval(auth)) });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/projects(?:\/([\w-]+))?$/);
    if (m && ((method === "POST" && !m[2]) || (method === "PATCH" && m[2]) || (method === "DELETE" && m[2]))) {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      if (!ownerOrAdminOf(auth, bot)) return json(res, 403, { error: "forbidden: only the bot owner or an admin can organize its folders", code: "bot_folders_owner_only" });
      if (m[2] && !store.project(bot.id, m[2])) return json(res, 404, { error: "no such folder" });
      if (method === "DELETE") {
        const updated = store.deleteProject(bot.id, m[2]!);
        return json(res, 200, { bot: projectBotTranscript(publicBot(updated!), viewerForApproval(auth)) });
      }
      const folder = parseFolderBody(await readBody(req), method === "POST");
      if (!folder.ok) return json(res, 400, { error: folder.error });
      const patch = folder.patch;
      const project = method === "POST"
        ? store.createProject(bot.id, patch.name!, patch.emoji)
        : store.patchProject(bot.id, m[2]!, patch);
      return json(res, method === "POST" ? 201 : 200, { project, bot: projectBotTranscript(publicBot(bot), viewerForApproval(auth)) });
    }
    return PASS;
  };
}
