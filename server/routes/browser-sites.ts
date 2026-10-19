// Signed-in sites of a bot's browser (server/browser-sites.ts does the work).
// GET /api/browser-sites?profile=<id> lists a shared browser profile's sites;
// ?bot=<id> lists the browser that bot uses now (its own, or its profile's).
// POST /api/browser-sites/sign-out {profile | bot, site?} signs out of that
// site, or of every site when `site` is absent; the person's own click, no
// confirm step. Both are admin-scoped by default in server/request-auth.ts,
// like the browser profiles themselves.
import type { BrowserSitesTarget, SignedInSites } from "../browser-sites.ts";
import { PASS, type RouteHandler } from "./table.ts";

export type BrowserSitesRef = { profile: string } | { bot: string };

export interface BrowserSitesRouteDeps {
  /** The browser session behind a profile or a bot, or why it has no sites
   * to show (no engine, a temporary or My Chrome browser, unknown id). */
  target(ref: BrowserSitesRef): BrowserSitesTarget | { status: number; error: string };
  list(target: BrowserSitesTarget): Promise<SignedInSites>;
  signOut(target: BrowserSitesTarget, site: string | null): Promise<SignedInSites>;
}

const ID = /^[\w.-]{1,128}$/u;
const SITE = /^[a-z0-9.:[\]-]{1,253}$/u;

function ref(value: { profile?: unknown; bot?: unknown }): BrowserSitesRef | null {
  if (typeof value.profile === "string" && ID.test(value.profile) && value.bot === undefined) return { profile: value.profile };
  if (typeof value.bot === "string" && ID.test(value.bot) && value.profile === undefined) return { bot: value.bot };
  return null;
}

function failure(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Could not read this browser's sign-ins.";
}

export function createBrowserSiteRoutes(deps: BrowserSitesRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, json, readBody }) => {
    if (path === "/api/browser-sites" && method === "GET") {
      const which = ref({ profile: url.searchParams.get("profile") ?? undefined, bot: url.searchParams.get("bot") ?? undefined });
      if (!which) return json(res, 400, { error: "Name one browser profile or one bot." });
      const target = deps.target(which);
      if ("error" in target) return json(res, target.status, { error: target.error });
      res.setHeader("cache-control", "no-store");
      try { return json(res, 200, await deps.list(target)); }
      catch (error) { return json(res, 503, { error: failure(error) }); }
    }
    if (path !== "/api/browser-sites/sign-out" || method !== "POST") return PASS;
    // JSON only, so a form posted from another local page cannot sign anyone out.
    const mediaType = String(req.headers["content-type"] ?? "").split(";", 1)[0]!.trim().toLowerCase();
    if (mediaType !== "application/json") return json(res, 415, { error: "content-type must be application/json" });
    const body = await readBody(req, 4096);
    const which = body && typeof body === "object" ? ref(body) : null;
    if (!which) return json(res, 400, { error: "Name one browser profile or one bot." });
    if (body.site !== undefined && (typeof body.site !== "string" || !SITE.test(body.site))) return json(res, 400, { error: "site must be a listed site" });
    const target = deps.target(which);
    if ("error" in target) return json(res, target.status, { error: target.error });
    try { return json(res, 200, await deps.signOut(target, body.site ?? null)); }
    catch (error) { return json(res, 503, { error: failure(error) }); }
  };
}
