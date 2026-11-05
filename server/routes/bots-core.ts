/**
 * Bots core HTTP routes (#1388 wave 3 B1): list/create bots, bot-defaults,
 * profile, primary, soul/system-prompt/overview/cards, active-branch,
 * projects and tasks.
 *
 * Registered in ROUTES after the auth gate. Never imports server/index.ts.
 * Each sibling owns its match scratch. Literal paths run before patterns.
 */
import { PASS, type RouteHandler } from "./table.ts";
import type {
  BotsCoreRouteDeps,
  BotsCoreRoutines,
  BotsCoreStore,
  BotsCoreVisible,
} from "./bots-core-deps.ts";
import { createBotsCoreListRoutes } from "./bots-core-list.ts";
import { createBotsCoreDefaultsRoutes } from "./bots-core-defaults.ts";
import { createBotsCoreCreateRoutes } from "./bots-core-create.ts";
import { createBotsCoreProfileRoutes } from "./bots-core-profile.ts";
import { createBotsCorePrimaryRoutes } from "./bots-core-primary.ts";
import { createBotsCoreSoulRoutes } from "./bots-core-soul.ts";
import { createBotsCoreCardsRoutes } from "./bots-core-cards.ts";
import { createBotsCoreProjectsRoutes } from "./bots-core-projects.ts";
import { createBotsCoreTasksRoutes } from "./bots-core-tasks.ts";
import { createBotsCoreTaskPatchRoutes } from "./bots-core-task-patch.ts";
import { createBotsCoreTaskDeleteRoutes } from "./bots-core-task-delete.ts";

export type { BotsCoreRouteDeps, BotsCoreRoutines, BotsCoreStore, BotsCoreVisible };

export function createBotsCoreRoutes(deps: BotsCoreRouteDeps): RouteHandler {
  // Same order as the monolith: literals, then profile, primary, soul,
  // cards, projects, then task collection before task id.
  const routes: readonly RouteHandler[] = [
    createBotsCoreListRoutes(deps),
    createBotsCoreDefaultsRoutes(deps),
    createBotsCoreCreateRoutes(deps),
    createBotsCoreProfileRoutes(deps),
    createBotsCorePrimaryRoutes(deps),
    createBotsCoreSoulRoutes(deps),
    createBotsCoreCardsRoutes(deps),
    createBotsCoreProjectsRoutes(deps),
    createBotsCoreTasksRoutes(deps),
    createBotsCoreTaskPatchRoutes(deps),
    createBotsCoreTaskDeleteRoutes(deps),
  ];
  return async (ctx) => {
    const { path } = ctx;
    if (!(path === "/api/bots" || path.startsWith("/api/bot-defaults") || path.startsWith("/api/bots/"))) return PASS;
    for (const route of routes) {
      const out = await route(ctx);
      if (out !== PASS) return out;
    }
    return PASS;
  };
}
