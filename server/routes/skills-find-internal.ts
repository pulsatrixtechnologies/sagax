// skills_find (#2613): the bot searches every marketplace its person can see
// (the official catalogs included) and the ClawHub registry for the best
// skills and plugins for a task. Served behind the per-turn agents capability
// the internal block of server/index.ts checks first, so this module is in
// INTERNAL_ROUTES, never in ROUTES. The bot is the capability's, never the
// body's. Reading only: installs go through act plugins.
//
//   POST /api/internal/skills-find   { query, limit?, clawhub? }  -> { text, hits }
import { z } from "zod";

import { findReport, missingCatalogs, rankLocal, searchClawHub, type FindListing } from "../plugins/skills-find.ts";
import { PASS } from "./table.ts";
import type { InternalRouteHandler } from "./internal-route.ts";

const body = z.object({
  fromBotId: z.string().optional(),
  fromThreadId: z.string().optional(),
  query: z.string().trim().min(1).max(400),
  limit: z.number().int().min(1).max(25).optional(),
  clawhub: z.boolean().optional(),
}).strict();

export function createSkillsFindInternalRoutes(deps: {
  /** The marketplaces this bot's person may see, with what the bot has. */
  listings(botId: string): FindListing[];
  fetcher?: typeof fetch;
}): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (path !== "/api/internal/skills-find") return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    const parsed = body.safeParse(await readBody());
    if (!parsed.success) return json(res, 400, { error: "skills_find needs query: the task, in a few words (for example: typescript code review, react testing)." });
    const { query } = parsed.data;
    const limit = parsed.data.limit ?? 10;
    let listings: FindListing[] = [];
    try { listings = deps.listings(capability.botId); } catch { listings = []; }
    const local = rankLocal(query, listings, limit);
    const missing = missingCatalogs(listings);
    const claw = parsed.data.clawhub === false ? { hits: [] } : await searchClawHub(query, Math.min(limit, 10), deps.fetcher ?? fetch);
    return json(res, 200, { text: findReport(query, local, missing, claw), hits: [...local, ...claw.hits], missing: missing.map((hit) => hit.source) });
  };
}
