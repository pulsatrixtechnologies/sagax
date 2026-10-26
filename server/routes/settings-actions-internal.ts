// POST /api/internal/settings: sagax_settings (server/settings-actions.ts).
// Every setting of the app, read or changed for the person speaking to the
// bot, through the act engine. Behind the agents capability (internal-route.ts).
import type { BotActResult } from "../bot-act.ts";
import type { InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";

export interface SettingsActionsInternalDeps {
  /** The bot the turn speaks as in that thread (a project's copy included). */
  speaking(botId: string, threadId: string): { name: string; color: string };
  handle(input: { args: Record<string, unknown>; botId: string; threadId: string; generation: string; botName: string; botColor: string }): Promise<BotActResult>;
}

export function createSettingsActionsInternalRoutes(deps: SettingsActionsInternalDeps): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (!(method === "POST" && path === "/api/internal/settings")) return PASS;
    const args = await readBody();
    const bot = deps.speaking(capability.botId, capability.threadId);
    const result = await deps.handle({ args, botId: capability.botId, threadId: capability.threadId, generation: capability.generation, botName: bot.name, botColor: bot.color });
    return json(res, result.status, result.body);
  };
}
