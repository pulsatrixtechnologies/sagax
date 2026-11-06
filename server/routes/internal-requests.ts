// Internal harness routes for routine / profile / model / rule proposals,
// team-setup and bot-deletion requests (#1388 I3). Behind the agents
// capability checked in server/index.ts before dispatchInternalRoutes.
import type { InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";
import type { InternalRequestsDeps } from "./internal-requests-handlers.ts";
import {
  handleInternalRequestsEarly,
  handleInternalRequestsLate,
  requestsEarlyPath,
  requestsLatePath,
} from "./internal-requests-handlers.ts";

export type {
  InternalRequestsBot,
  InternalRequestsDeps,
  InternalRequestsInstance,
  InternalRequestsProposed,
  InternalRequestsRoutine,
  InternalRequestsRun,
  InternalRequestsThreadOwner,
  InternalRequestsWebhook,
} from "./internal-requests-handlers.ts";

export function createInternalRequestsRoutes(deps: InternalRequestsDeps): InternalRouteHandler {
  return async (ctx) => {
    const { path, method } = ctx;
    if (requestsEarlyPath(method, path)) return handleInternalRequestsEarly(deps, ctx);
    if (requestsLatePath(method, path)) return handleInternalRequestsLate(deps, ctx);
    return PASS;
  };
}
