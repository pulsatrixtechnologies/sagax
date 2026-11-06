/**
 * Public groups (channels) HTTP routes (#1388 wave 2 P4):
 * /api/groups, /api/groups/:id, tasks, messages, leave, read, queue, interrupt.
 *
 * Registered in ROUTES after the auth gate. Never imports server/index.ts.
 * The group turn runner (startGroupTurn) is injected as a function.
 * Factory is a composer (#1383). Literal /api/groups routes run before :id patterns.
 */
import type { GroupsHttpDeps } from "./groups-http-types.ts";
import { getGroups, postGroups } from "./groups-http-list.ts";
import { postGroupTasks, postGroupTask, patchGroupTask, deleteGroupTask } from "./groups-http-tasks.ts";
import { patchGroup, postGroupLeave, postGroupRead, deleteGroup } from "./groups-http-group.ts";
import { postGroupMessages } from "./groups-http-messages.ts";
import { deleteGroupQueueItem, postGroupQueueSteer, postGroupInterrupt } from "./groups-http-queue.ts";
import { PASS, type RouteHandler } from "./table.ts";

export type { GroupsHttpDeps, GroupsHttpStore, GroupsHttpVisible } from "./groups-http-types.ts";

const HANDLERS = [
  getGroups,
  postGroups,
  postGroupTasks,
  postGroupTask,
  patchGroupTask,
  deleteGroupTask,
  patchGroup,
  postGroupLeave,
  postGroupRead,
  deleteGroup,
  postGroupMessages,
  deleteGroupQueueItem,
  postGroupQueueSteer,
  postGroupInterrupt,
] as const;

export function createGroupsHttpRoutes(deps: GroupsHttpDeps): RouteHandler {
  return async (ctx) => {
    const { path } = ctx;
    if (!path.startsWith("/api/groups")) return PASS;
    // /api/groups/:id/memory and folders live in their own modules.
    if (/^\/api\/groups\/[\w-]+\/(memory|folders)(?:\/|$)/.test(path)) return PASS;
    if (/^\/api\/groups\/[\w-]+\/bots\//.test(path)) return PASS;
    // Computed even when no handler matches, as the monolith did.
    const scratch = {
      visible: deps.visibleFor(ctx.auth, path),
      viewerId: deps.viewerId(ctx.auth),
    };
    for (const handle of HANDLERS) {
      const out = await handle(deps, ctx, scratch);
      if (out !== PASS) return;
    }
    return PASS;
  };
}
