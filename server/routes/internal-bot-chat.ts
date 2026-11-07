// Internal harness routes for bot-to-bot chat (#1388 slice I5a):
// ask-bot, delegations status, retry-thread, delegate-bot, room-targets, coordinate-bots, assignment-status.
//
// Answers only behind the per-turn capability the internal block of
// server/index.ts checks first. Capability gate and refusal checks stay there.
// startTurn and other turn runners are injected; this module never imports index.ts.
import type { InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";
import type { InternalBotChatDeps } from "./internal-bot-chat-handlers.ts";
import {
  handleAskBot,
  handleAssignmentStatus,
  handleDelegateBot,
  handleDelegationStatus,
  handleRetryThread,
  handleRoomCoordination,
  openInternalBotChat,
} from "./internal-bot-chat-handlers.ts";

export type {
  InternalBotChatBot,
  InternalBotChatCoordinator,
  InternalBotChatDeps,
  InternalBotChatGroup,
  InternalBotChatMessage,
  InternalBotChatStore,
  InternalBotChatTask,
} from "./internal-bot-chat-handlers.ts";

export function createInternalBotChatRoutes(deps: InternalBotChatDeps): InternalRouteHandler {
  return async (ctx) => {
    const opened = openInternalBotChat(deps, ctx);
    if (!opened) return PASS;
    const { method, path } = opened;
    if (method === "POST" && path === "/api/internal/ask-bot") return handleAskBot(opened);
    const delegationMatch = method === "GET" ? path.match(/^\/api\/internal\/delegations\/([\w-]{4,64})$/) : null;
    if (delegationMatch?.[1]) return handleDelegationStatus(opened, delegationMatch[1]);
    if (method === "POST" && path === "/api/internal/retry-thread") return handleRetryThread(opened);
    if (method === "POST" && path === "/api/internal/delegate-bot") return handleDelegateBot(opened);
    if (method === "GET" && path === "/api/internal/assignment-status") return handleAssignmentStatus(opened);
    if (method === "GET" && path === "/api/internal/room-targets") return handleRoomCoordination(opened);
    if (method === "POST" && path === "/api/internal/coordinate-bots") return handleRoomCoordination(opened);
    return PASS;
  };
}
