// GET /api/team-board (#3409): the signed-in person's Team board, computed
// on demand from their bots' code work and their own GitHub account. Read
// only. Same builder as the `team-board` page source
// (server/pages/sources/team-board.ts); this route is the door for the
// native Tools page (lot 1b).
import type { RequestAuth } from "../auth/request-auth.ts";
import { PageSourceError } from "../pages/page-sources.ts";
import { readTeamBoard, type TeamBoardSourceDeps } from "../pages/sources/team-board.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface TeamBoardRouteDeps {
  /** Same deps the page source uses: per person teams, bots, entries, GitHub. */
  board: TeamBoardSourceDeps;
}

function queryParams(url: URL): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const key of ["team", "column"] as const) {
    const value = url.searchParams.get(key);
    if (value !== null) params[key] = value;
  }
  return params;
}

function langOf(url: URL): "fr" | "en" | undefined {
  const lang = url.searchParams.get("lang");
  return lang === "fr" || lang === "en" ? lang : undefined;
}

export function createTeamBoardRoutes(deps: TeamBoardRouteDeps): RouteHandler {
  return async ({ res, path, method, auth, json, url }) => {
    if (!(method === "GET" && path === "/api/team-board")) return PASS;
    const fresh = url.searchParams.get("fresh") === "1";
    const params = queryParams(url);
    const lang = langOf(url);
    try {
      const { board } = await readTeamBoard(deps.board, auth as RequestAuth, fresh, {
        params,
        ...(lang ? { lang } : {}),
      });
      return json(res, 200, board);
    } catch (error) {
      if (error instanceof PageSourceError) {
        return json(res, error.status, { error: error.message, code: error.code });
      }
      throw error;
    }
  };
}
