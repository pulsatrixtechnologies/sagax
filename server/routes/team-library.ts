// Team library catalog, slug fetch and GitHub import (#1388 slice P1).
// Creates nothing: each route only reads a remote team document.
import { fetchGithubTeam, fetchLibraryTeam, fetchTeamCatalog } from "../team-library.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface TeamLibraryRouteDeps {
  fetchCatalog?: typeof fetchTeamCatalog;
  fetchTeam?: typeof fetchLibraryTeam;
  fetchGithub?: typeof fetchGithubTeam;
}

export function createTeamLibraryRoutes(deps: TeamLibraryRouteDeps = {}): RouteHandler {
  const fetchCatalog = deps.fetchCatalog ?? fetchTeamCatalog;
  const fetchTeam = deps.fetchTeam ?? fetchLibraryTeam;
  const fetchGithub = deps.fetchGithub ?? fetchGithubTeam;

  return async ({ req, res, path, method, json, readBody }) => {
    if (method === "GET" && path === "/api/team-library/catalog") {
      try {
        return json(res, 200, await fetchCatalog());
      } catch (error) {
        return json(res, 502, { error: error instanceof Error ? error.message : "The team library is unavailable" });
      }
    }
    let m = path.match(/^\/api\/team-library\/teams\/([a-z0-9][a-z0-9-]*)$/);
    if (m && method === "GET") {
      try {
        return json(res, 200, await fetchTeam(m[1]!));
      } catch (error) {
        const status = (error as { status?: number }).status === 404 ? 404 : 502;
        return json(res, status, { error: error instanceof Error ? error.message : "The team could not be loaded" });
      }
    }
    if (method === "POST" && path === "/api/team-library/github") {
      const body = await readBody(req);
      if (typeof body?.url !== "string" || !body.url.trim()) {
        return json(res, 400, { error: "A GitHub URL is required" });
      }
      try {
        return json(res, 200, await fetchGithub(body.url));
      } catch (error) {
        const status = (error as { status?: number }).status === 404 ? 404 : 400;
        return json(res, status, { error: error instanceof Error ? error.message : "The GitHub team could not be loaded" });
      }
    }
    return PASS;
  };
}
