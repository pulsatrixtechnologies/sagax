// Internal harness routes for environments (#1388 slice I1):
// computer/select, browser/mcp, sandbox/mcp, personal-mcp, desktop/mcp,
// workplace/mcp, computer/mcp, messages/mcp, phone/claim, shared-computers,
// computer-control.
//
// Answers only behind the per-turn capability the internal block of
// server/index.ts checks first. Capability gate and refusal checks stay there.
// Connectors: capability kind stays in index.ts; Composio's connectors/mcp
// body was removed earlier, so there is no handler body to move.
import type { InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";
import type { InternalEnvironmentsDeps } from "./internal-environments-handlers.ts";
import {
  routeBrowserMcp,
  routeComputerControl,
  routeComputerMcp,
  routeComputerSelect,
  routeDesktopMcp,
  routeMessagesMcp,
  routePersonalMcp,
  routePhoneClaim,
  routeSandboxMcp,
  routeSharedComputersGet,
  routeSharedComputersPost,
  routeWorkplaceMcp,
} from "./internal-environments-handlers.ts";

export type {
  ComputerSelectionSource,
  InternalEnvironmentsBot,
  InternalEnvironmentsDeps,
  SelectableComputer,
} from "./internal-environments-handlers.ts";

const ENVIRONMENT_ROUTES = [
  routeComputerSelect,
  routeBrowserMcp,
  routeSandboxMcp,
  routePersonalMcp,
  routeDesktopMcp,
  routeWorkplaceMcp,
  routeComputerMcp,
  routeMessagesMcp,
  routePhoneClaim,
  routeSharedComputersGet,
  routeSharedComputersPost,
  routeComputerControl,
] as const;

export function createInternalEnvironmentsRoutes(deps: InternalEnvironmentsDeps): InternalRouteHandler {
  return async (ctx) => {
    const { path, capability } = ctx;

    // computer-control looks up the bot from the query string; every other
    // route needs the capability's bot.
    if (path !== "/api/internal/computer-control") {
      const sender = deps.bot(capability.botId);
      if (!sender) return PASS;
    }

    for (const route of ENVIRONMENT_ROUTES) {
      const answer = route(deps, ctx);
      if (answer !== PASS) return answer;
    }
    return PASS;
  };
}
