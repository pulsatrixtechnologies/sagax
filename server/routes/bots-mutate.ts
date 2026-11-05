/**
 * Leftover authenticated bot mutate routes (#1388): model, read, Auto preview,
 * command allowlist, always-allow, PATCH/DELETE bot, guarded request interrupt.
 *
 * Registered in ROUTES after the auth gate. Never imports server/index.ts.
 * Pure move of the former fallback() handlers; behaviour unchanged.
 */
import { PASS, type RouteHandler } from "./table.ts";
import { bindBotsMutateEnv, type BotsMutateRouteDeps } from "./bots-mutate-helpers.ts";
import { handleSmallBotMutations } from "./bots-mutate-small.ts";
import { handleBotPatch } from "./bots-mutate-patch.ts";
import { handleBotDeleteAndRequests } from "./bots-mutate-delete.ts";

export type { BotsMutateRouteDeps };

export function createBotsMutateRoutes(deps: BotsMutateRouteDeps): RouteHandler {
  return async (ctx) => {
    if (!ctx.path.startsWith("/api/bots/")) return PASS;
    const env = bindBotsMutateEnv(deps, ctx);
    if (await handleSmallBotMutations(env)) return;
    if (await handleBotPatch(env)) return;
    if (await handleBotDeleteAndRequests(env)) return;
    return PASS;
  };
}
