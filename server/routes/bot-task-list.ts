// The person's task list for one bot (shared/bot-task-list.ts).
//
//   GET    /api/bots/:id/task-list
//   POST   /api/bots/:id/task-list                 { title, state?, note? }
//   POST   /api/bots/:id/task-list/:tid/advance    doing to waiting
//   POST   /api/bots/:id/task-list/:tid/complete   to done
//   POST   /api/bots/:id/task-list/:tid/resume     waiting back in progress
//   POST   /api/bots/:id/task-list/:tid/reopen     done back in progress
//   DELETE /api/bots/:id/task-list/:tid            remove it
//
// The bot uses POST /api/internal/task-list
//   { action: list | add | advance | complete | note, title?, state?, note?, task_id? }.
// It names a task by task_id, or by its exact title. It cannot resume,
// reopen or remove: those are the person's. The bot id is the turn's,
// never the body's.
import type { RequestAuth } from "../auth/request-auth.ts";
import type { BotTaskStore } from "../bots/bot-task-list.ts";
import { BOT_TOOL_TASK_ACTIONS, findBotTask, isBotTaskId, sameBotTaskOwner, type BotTask, type BotTaskAction } from "../../shared/bot-task-list.ts";
import type { InternalRouteHandler } from "./internal-route.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface BotTaskRouteDeps {
  tasks: () => BotTaskStore;
  mayUseBot(auth: RequestAuth, botId: string): boolean;
  /** Whose list this is. Undefined on a one-person server. */
  owner(auth: RequestAuth): string | undefined;
  mayView(auth: RequestAuth, task: BotTask): boolean;
}

const LIST = /^\/api\/bots\/([\w-]+)\/task-list$/;
const MOVE = /^\/api\/bots\/([\w-]+)\/task-list\/(task_[A-Za-z0-9_-]+)\/(advance|complete|resume|reopen)$/;
const ONE = /^\/api\/bots\/([\w-]+)\/task-list\/(task_[A-Za-z0-9_-]+)$/;

export function createBotTaskRoutes(deps: BotTaskRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const list = (method === "GET" || method === "POST") ? LIST.exec(path) : null;
    const move = method === "POST" ? MOVE.exec(path) : null;
    const one = method === "DELETE" ? ONE.exec(path) : null;
    const matched = list || move || one;
    if (!matched) return PASS;
    const botId = matched[1]!;
    if (!deps.mayUseBot(auth, botId)) return json(res, 404, { error: "no such bot", code: "not_found" });
    res.setHeader("cache-control", "private, no-store");
    const store = deps.tasks();
    const owner = deps.owner(auth);
    if (list && method === "GET") {
      return json(res, 200, { tasks: store.list(botId).filter((task) => deps.mayView(auth, task)) });
    }
    if (list) {
      const result = store.add(botId, await readBody(req), owner, undefined, "person");
      if (!result.ok) return json(res, result.status, { error: result.error, code: result.code });
      return json(res, 201, { task: result.task });
    }
    const id = matched[2]!;
    const missing = () => json(res, 404, { error: "No task with that id for this bot.", code: "not_found" });
    if (!isBotTaskId(id)) return missing();
    const current = store.list(botId).find((task) => task.id === id);
    if (!current || !deps.mayView(auth, current)) return missing();
    const result = one
      ? store.remove(botId, id, owner)
      : store.move(botId, id, move![3] as BotTaskAction, owner, "person");
    if (!result.ok) return json(res, result.status, { error: result.error, code: result.code });
    return one ? json(res, 200, { removed: true, task: result.task }) : json(res, 200, { task: result.task });
  };
}

export function createBotTaskInternalRoutes(deps: {
  tasks: () => BotTaskStore;
  ownsThread(botId: string, threadId: string): boolean;
  speaker?(threadId: string): string | undefined;
}): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (path !== "/api/internal/task-list") return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (!deps.ownsThread(capability.botId, capability.threadId)) {
      return json(res, 403, { error: "source conversation does not belong to sender" });
    }
    const body = await readBody() as { action?: unknown; title?: unknown; state?: unknown; note?: unknown; task_id?: unknown } | null;
    const action = body?.action;
    const store = deps.tasks();
    const botId = capability.botId;
    const owner = deps.speaker?.(capability.threadId);
    const mine = () => store.list(botId).filter((task) => sameBotTaskOwner(task.ownerId, owner));
    if (action === "list") return json(res, 200, { tasks: mine() });
    if (action === "add") {
      const result = store.add(botId, { title: body?.title, state: body?.state, ...(body?.note !== undefined ? { note: body.note } : {}) }, owner, capability.threadId, "bot");
      if (!result.ok) return json(res, result.status, { error: result.error, code: result.code });
      return json(res, 201, { task: result.task });
    }
    const toolMove = typeof action === "string" && (BOT_TOOL_TASK_ACTIONS as readonly string[]).includes(action);
    if (!toolMove && action !== "note") {
      return json(res, 400, { error: "action: list, add, advance, complete or note. Putting back in progress, reopening and removing are the person's.", code: "bad_action" });
    }
    const found = findBotTask(mine(), { taskId: body?.task_id, title: body?.title });
    if (found === "ambiguous") return json(res, 409, { error: "Several tasks have that title: use the task_id that list gave.", code: "ambiguous" });
    if (!found) return json(res, 404, { error: "No such task: give the task_id that list or add gave, or its exact title.", code: "not_found" });
    const result = action === "note"
      ? store.note(botId, found.id, body?.note ?? "", owner)
      : store.move(botId, found.id, action as BotTaskAction, owner, "bot");
    if (!result.ok) return json(res, result.status, { error: result.error, code: result.code });
    return json(res, 200, { task: result.task });
  };
}
