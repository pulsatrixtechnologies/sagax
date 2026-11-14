// GET /api/bots/:id/watchable-resources (#4250, S4): what the person viewing
// can watch in their products, as Perspicax lists it, for the routine
// editor's "When something changes in a product". `{ available, resources }`:
// `available: false` on a solo server or when Perspicax cannot be read (the
// editor then keeps its free field alone). Read with the viewer's own
// sign-in, never the bot owner's: a person only sees what they can read.
//
// Client-scoped like every /api/bots/:id/ route; the bot visibility check
// (bot-visibility.ts pathSubject) answers a hidden bot as missing first.
import type { RequestAuth } from "../auth/request-auth.ts";
import type { WatchableResource } from "../perspicax/perspicax-mcp.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const WATCHABLE_TIMEOUT_MS = 15_000;

export interface WatchableResourcesDeps {
  bot(id: string): { id: string } | null | undefined;
  /** The person making the request (their principal id), or null. */
  viewer(auth: RequestAuth): string | null;
  /** PerspicaxMcp.watchableResources; null when unavailable. */
  list(principalId: string, signal: AbortSignal): Promise<WatchableResource[] | null>;
}

export function createWatchableResourcesRoutes(deps: WatchableResourcesDeps): RouteHandler {
  return async ({ res, path, method, auth, json }) => {
    const m = /^\/api\/bots\/([\w-]+)\/watchable-resources$/.exec(path);
    if (!m || method !== "GET") return PASS;
    const bot = deps.bot(m[1]!);
    if (!bot) return json(res, 404, { error: "no such bot" });
    res.setHeader("cache-control", "no-store");
    const viewer = deps.viewer(auth);
    if (!viewer) return json(res, 200, { available: false, resources: [] });
    let resources: WatchableResource[] | null = null;
    try {
      resources = await deps.list(viewer, AbortSignal.timeout(WATCHABLE_TIMEOUT_MS));
    } catch {
      resources = null;
    }
    return json(res, 200, resources ? { available: true, resources } : { available: false, resources: [] });
  };
}
