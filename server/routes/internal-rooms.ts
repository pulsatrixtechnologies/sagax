// Internal harness routes for rooms and bot creation (#1388 slice I5b):
// post-to-room, run-with-engine, threads (POST start/handoff), create-bot,
// create-room, manage-room.
//
// Answers only behind the per-turn capability the internal block of
// server/index.ts checks first. Capability gate and refusal checks stay there.
// startTurn / startOrQueueOpenedThread / startParallelTask and other turn
// runners are injected; this module never imports index.ts.
//
// Factory is a composer (#1383): each literal route lives in a sibling file.
// Dispatch order matches the previous monolith. Every path here is a literal.
import type { InternalRouteHandler } from "./internal-route.ts";
import { openInternalRoomsCall } from "./internal-rooms-call.ts";
import { handleCreateBot } from "./internal-rooms-create-bot.ts";
import { handleRunWithEngine } from "./internal-rooms-engine.ts";
import { handlePostToRoom } from "./internal-rooms-post.ts";
import { handleCreateOrManageRoom } from "./internal-rooms-room.ts";
import { handleInternalThreads } from "./internal-rooms-threads.ts";
import type { InternalRoomsDeps } from "./internal-rooms-types.ts";
import { PASS } from "./table.ts";

export type {
  InternalRoomsBot,
  InternalRoomsCoordinator,
  InternalRoomsDeps,
  InternalRoomsGroup,
  InternalRoomsStore,
  InternalRoomsTask,
} from "./internal-rooms-types.ts";

const HANDLERS = [
  handlePostToRoom,
  handleRunWithEngine,
  handleInternalThreads,
  handleCreateBot,
  handleCreateOrManageRoom,
] as const;

export function createInternalRoomsRoutes(deps: InternalRoomsDeps): InternalRouteHandler {
  return async (ctx) => {
    const call = openInternalRoomsCall(deps, ctx);
    if (!call) return PASS;
    for (const handle of HANDLERS) {
      const out = await handle(call);
      if (out !== PASS) return;
    }
    return PASS;
  };
}
