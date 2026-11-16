import { PASS, type RouteHandler } from "./table.ts";

export interface SavedStepsRouteDeps {
  bot(id: string): unknown;
  forget(botId: string, recipeId: string): boolean;
}

const RECIPE_ID = /^[\w-]{1,64}$/;

/** #4471: client scope marked `owner: "bot"` (server/auth/client-allow.ts): the gate lets only the bot's owner, an edit grant or an admin forget a saved recipe. */
export function createSavedStepsRoutes(deps: SavedStepsRouteDeps): RouteHandler {
  return async ({ res, path, method, json }) => {
    const m = path.match(/^\/api\/bots\/([\w-]+)\/saved-steps\/([^/]+)$/);
    if (!m || method !== "DELETE") return PASS;
    if (!deps.bot(m[1])) return json(res, 404, { error: "bot not found" });
    if (!RECIPE_ID.test(m[2])) return json(res, 400, { error: "recipe id must be letters, digits, - or _" });
    return json(res, 200, { forgotten: deps.forget(m[1], m[2]) });
  };
}
