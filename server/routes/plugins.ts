// The Plugins screen (iOS parity 15; Part B of
// docs/superpowers/specs/2026-09-30-mcp-sign-in-and-plugin-catalog-design.md).
//
//   GET  /api/plugins/search?q=&cursor=
//        { featured: [listing], results: [listing], nextCursor, registryAvailable }
//        featured (shared/plugin-catalog.json) on the first page only, then the
//        official MCP Registry's community servers (server/plugin-registry.ts).
//        Each listing says whether it is installed (an MCP server with its URL).
//   GET  /api/plugins/installed
//        { plugins: [{ kind: "mcp", name, url, domain, enabled, auth, icon?, catalogId? }], count }
//   POST /api/plugins/install { id, region?, trust?, returnTo?, callbackOrigin? }
//        adds the server (enabled; a server that still needs a sign-in is never
//        mounted for a turn) and, when it asks for one, starts its OAuth sign-in:
//        { name, alreadyInstalled, auth, authorizationUrl? }. A registry entry
//        needs `trust: true` (it is not reviewed). A listing with `regions`
//        connects to the chosen one (`region`, its id; the default address
//        without it); an id it does not list answers 400. Server admins and the owner
//        of a personal computer only (admin scope for sessions).
//
// Reads are member scope: names, descriptions, addresses and icons, never a
// header value or token.
import type { IncomingMessage } from "node:http";

import { PLUGIN_CATALOG } from "../../shared/plugin-catalog.ts";
import { featuredListing, featuredMatching, listingInRegion, type PluginListing, type RegistrySearch } from "../plugin-registry.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export type InstalledPlugin =
  | { kind: "mcp"; name: string; url: string; domain: string; enabled: boolean; auth: string; icon?: string; catalogId?: string };

export interface PluginRouteDeps {
  registry: RegistrySearch;
  installed: () => Promise<InstalledPlugin[]>;
  mayInstall: (auth: RequestAuth) => boolean;
  install: (listing: PluginListing, request: { req: IncomingMessage; auth: RequestAuth; returnTo?: unknown; callbackOrigin?: unknown }) =>
    Promise<{ status: number; body: Record<string, unknown> }>;
}

/** The MCP server name a plugin is added under: its id, made safe. */
export function pluginServerName(listing: Pick<PluginListing, "id">, taken: ReadonlySet<string>): string {
  const base = (listing.id.startsWith("registry:") ? listing.id.slice("registry:".length).split("/").pop()! : listing.id)
    .toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z]+/, "").replace(/-+$/, "").slice(0, 28) || "plugin";
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 100; suffix++) {
    const candidate = `${base.slice(0, 28)}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 20)}-${Date.now().toString(36).slice(-6)}`;
}

export function createPluginRoutes(deps: PluginRouteDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (!path.startsWith("/api/plugins/")) return PASS;
    res.setHeader("cache-control", "private, no-store");

    if (path === "/api/plugins/installed") {
      if (method !== "GET") return json(res, 405, { error: "GET only" });
      const plugins = await deps.installed();
      return json(res, 200, { plugins, count: plugins.length });
    }

    if (path === "/api/plugins/search") {
      if (method !== "GET") return json(res, 405, { error: "GET only" });
      const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
      const cursor = url.searchParams.get("cursor") || undefined;
      if (cursor && cursor.length > 500) return json(res, 400, { error: "cursor is not one this server returned" });
      const [page, installed] = await Promise.all([deps.registry.search(q, cursor), deps.installed()]);
      const installedUrls = new Set(installed.map((plugin) => plugin.url));
      const mark = (listing: PluginListing) => {
        const region = listing.regions?.find((candidate) => installedUrls.has(candidate.url));
        return { ...listing, installed: installedUrls.has(listing.url) || Boolean(region), ...(region ? { installedRegion: region.id } : {}) };
      };
      const featured = cursor ? [] : (q ? featuredMatching(q) : PLUGIN_CATALOG.map(featuredListing));
      const featuredUrls = new Set(featured.map((listing) => listing.url));
      return json(res, 200, {
        featured: featured.map(mark),
        // the same server, reviewed, is already above
        results: page.results.filter((listing) => !featuredUrls.has(listing.url) && !PLUGIN_CATALOG.some((entry) => entry.url === listing.url)).map(mark),
        nextCursor: page.nextCursor,
        registryAvailable: page.available,
      });
    }

    if (path === "/api/plugins/install") {
      if (method !== "POST") return json(res, 405, { error: "POST only" });
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) return json(res, 415, { error: "content-type must be application/json" });
      if (!deps.mayInstall(auth)) return json(res, 403, { error: "forbidden: only an admin or this computer's owner can add plugins" });
      const body = await readBody(req) as Record<string, unknown> | null;
      const id = typeof body?.id === "string" ? body.id.trim() : "";
      if (!id || id.length > 300) return json(res, 400, { error: "id must name a plugin from the catalog or the registry" });
      let listing: PluginListing | null = null;
      if (id.startsWith("registry:")) {
        if (body?.trust !== true) return json(res, 400, { error: "This community server is not reviewed. Confirm you trust it (trust: true).", code: "trust_required" });
        listing = await deps.registry.lookup(id.slice("registry:".length));
        if (!listing) return json(res, 404, { error: "That server is not in the registry (or the registry is unreachable).", code: "not_found" });
      } else {
        const entry = PLUGIN_CATALOG.find((candidate) => candidate.id === id);
        if (!entry) return json(res, 404, { error: "No plugin with that id.", code: "not_found" });
        listing = featuredListing(entry);
      }
      const regionId = typeof body?.region === "string" && body.region ? body.region : undefined;
      const regional = listingInRegion(listing, regionId);
      if (!regional) return json(res, 400, { error: "That data center is not one this plugin offers.", code: "unknown_region" });
      listing = regional;
      if (listing.auth === "headers" || listing.auth === "api-key") {
        return json(res, 400, { error: "This server needs a key in its headers: add it on your computer, in Settings > MCP servers.", code: "headers_required" });
      }
      const installed = await deps.install(listing, { req, auth, returnTo: body?.returnTo, callbackOrigin: body?.callbackOrigin });
      return json(res, installed.status, installed.body);
    }

    return PASS;
  };
}
