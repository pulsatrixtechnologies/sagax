/**
 * Bot messaging HTTP routes (#1388 wave 3 B3): browser live/action and
 * /api/bots/:id/messages(/guarded), queue, parallel stop, steer, compact,
 * edit, respond (bot and thread), interrupt.
 *
 * Registered in ROUTES after the auth gate. Never imports server/index.ts.
 * Heavy turn runners are injected as deps.
 */
import { PASS, type RouteHandler } from "./table.ts";
import type { BotsMessagesRouteDeps } from "./bots-messages-deps.ts";
import { createBotsMessagesBrowserRoutes } from "./bots-messages-browser.ts";
import { createBotsMessagesSendRoutes } from "./bots-messages-send.ts";
import {
  createBotsMessagesParallelStopRoutes,
  createBotsMessagesQueueDeleteRoutes,
  createBotsMessagesQueueSteerRoutes,
} from "./bots-messages-queue.ts";
import {
  createBotsMessagesCompactRoutes,
  createBotsMessagesEditRoutes,
} from "./bots-messages-edit.ts";
import {
  createBotsMessagesBotRespondRoutes,
  createBotsMessagesThreadRespondRoutes,
} from "./bots-messages-respond.ts";
import { createBotsMessagesInterruptRoutes } from "./bots-messages-interrupt.ts";

export type { BotsMessagesRouteDeps } from "./bots-messages-deps.ts";

export function createBotsMessagesRoutes(deps: BotsMessagesRouteDeps): RouteHandler {
  const handlers = [
    createBotsMessagesBrowserRoutes(deps),
    createBotsMessagesSendRoutes(deps),
    createBotsMessagesQueueDeleteRoutes(deps),
    createBotsMessagesParallelStopRoutes(deps),
    createBotsMessagesQueueSteerRoutes(deps),
    createBotsMessagesCompactRoutes(deps),
    createBotsMessagesEditRoutes(deps),
    createBotsMessagesBotRespondRoutes(deps),
    createBotsMessagesThreadRespondRoutes(deps),
    createBotsMessagesInterruptRoutes(deps),
  ];
  return async (ctx) => {
    const { path } = ctx;
    if (!(path.startsWith("/api/bots/") || /^\/api\/threads\/[\w-]+\/respond$/.test(path))) {
      return PASS;
    }
    for (const handler of handlers) {
      const out = await handler(ctx);
      if (out !== PASS) return out;
    }
    return PASS;
  };
}
