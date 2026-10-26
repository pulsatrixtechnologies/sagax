// POST /api/team-library/grok { url }: the public card of a shared Grok Bot
// (name, creator, description) from its x.ai link or marketplace page. Port of
// OpenMausBot #3073 without its optional Cursor sign-in. Only x.ai is fetched
// (redirects must stay there, 20 s, 2 MB; server/team-library.ts). The full
// setup comes from the person's own Grok Bot (shared/grok-import.ts), read in
// the app; this route creates nothing. Same scope as the GitHub import (team-library:write): it only reads x.ai.
import { fetchGrokTemplateCard } from "../team-library.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createTeamLibraryGrokRoutes(deps: { fetcher?: typeof fetch } = {}): RouteHandler {
  return async ({ req, res, path, method, json, readBody }) => {
    if (!(method === "POST" && path === "/api/team-library/grok")) return PASS;
    const body = await readBody(req, 16_384).catch(() => null) as { url?: unknown } | null;
    if (typeof body?.url !== "string" || !body.url.trim()) return json(res, 400, { error: "A Grok Bot share link is required" });
    try {
      return json(res, 200, await fetchGrokTemplateCard(body.url, deps.fetcher));
    } catch (error) {
      const status = (error as { status?: number }).status;
      return json(res, status === 400 || status === 404 ? status : 502, {
        error: error instanceof Error ? error.message : "The Grok Bot could not be loaded",
      });
    }
  };
}
