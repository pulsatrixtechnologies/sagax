// Plugins > Manage > Marketplaces: the installation's own plugin
// marketplaces (server/plugin-marketplaces.ts).
//
//   GET    /api/marketplaces                              { marketplaces }
//   POST   /api/marketplaces { source, ref?, credential?, visibility? }  add or fetch again
//   POST   /api/marketplaces/:name/refresh
//   DELETE /api/marketplaces/:name                         (no plugin installed)
//   PUT    /api/marketplaces/:name/credential { credential: id | null }   pick one of the list, or Automatic
//   POST   /api/marketplaces/:name/plugins/:plugin         install: MCP servers + skills
//   POST   /api/marketplaces/:name/plugins/:plugin/update  update them in place
//   DELETE /api/marketplaces/:name/plugins/:plugin         uninstall them
//
// Same scope as /api/mcp/servers: admin (never in CLIENT_ALLOW), so on an
// organization server the clone and the install happen on that server for
// its administrators, and on a personal server for its owner.
//
// A private marketplace reads with the credential the installation picks
// for it (the one list, the GitHub plugin's page in Capabilities), else the
// acting person's GitHub connection, then their other credentials and the
// organization's. The pick is audited (`marketplace.credential`) and never
// carries a token (`hasToken` only says there is one).
import type { IncomingMessage } from "node:http";

import { setCapabilityDeprecationHeaders } from "../capability-route-deprecation.ts";
import { MarketplaceError, type MarketplaceView, type MarketplaceViewer, type MarketplaceVisibility, type PluginMarketplaces } from "../plugin-marketplaces.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { MarketplaceCredentialView } from "../../shared/github-credentials.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface MarketplaceRouteDeps {
  store: PluginMarketplaces;
  mayManage: (auth: RequestAuth) => boolean;
  actor: (auth: RequestAuth) => string | undefined;
  /** Who is asking: an org-wide marketplace is listed to everyone, a private
   * one to the person who added it only (and the operator). Absent: unfiltered. */
  viewer?: (auth: RequestAuth) => MarketplaceViewer;
  /** May this caller share a marketplace with the whole organization? When
   * absent, anyone who manages marketplaces may share their own. */
  mayShareOrgWide?: (auth: RequestAuth) => boolean;
  install: (marketplace: string, plugin: string, request: { req: IncomingMessage; auth: RequestAuth }) =>
    Promise<{ status: number; body: Record<string, unknown> }>;
  uninstall: (marketplace: string, plugin: string) => Promise<{ status: number; body: Record<string, unknown> }>;
  /** Update an installed plugin in place: its servers keep their names,
   * switches and bot selections, its skills their review state. */
  update: (marketplace: string, plugin: string, request: { req: IncomingMessage; auth: RequestAuth }) =>
    Promise<{ status: number; body: Record<string, unknown> }>;
  /** One admin activity row for a plugin updated (written on success). */
  audit: (auth: RequestAuth, row: { action: string; target: { kind: string; id: string; name: string }; before?: Record<string, unknown>; after?: Record<string, unknown> }) => void;
  /** The installation's pick per marketplace (server/bot-plugins.ts). */
  workspace?: {
    addWorkspaceMarketplace(input: { source: string; ref?: string; credential?: string; visibility?: MarketplaceVisibility }, actor: string | undefined): Promise<MarketplaceView>;
    refreshWorkspaceMarketplace(name: string, actor: string | undefined): Promise<unknown>;
    /** pick a credential of the one list for everyone, or (null) Automatic */
    chooseWorkspaceMarketplaceCredential?(name: string, credential: string | null, actor: string | undefined): void;
    workspaceCredential?(source: string, viewer: string | undefined): MarketplaceCredentialView | undefined;
    removeWorkspaceMarketplace(name: string): Promise<void>;
    workspaceTokenSources(): Set<string>;
  };
}

/** undefined: none sent (defaults to private in the store); null: invalid. */
function visibilityField(value: unknown): MarketplaceVisibility | null | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return value === "private" || value === "org" ? value : null;
}

const NAME = "[A-Za-z0-9][A-Za-z0-9._-]{0,63}";
const MARKET = new RegExp(`^/api/marketplaces/(${NAME})(?:/(refresh|visibility|credential))?$`);
const CREDENTIAL = /^gt_[0-9a-f]{16}$/;
const PLUGIN = new RegExp(`^/api/marketplaces/(${NAME})/plugins/(${NAME})$`);
const UPDATE = new RegExp(`^/api/marketplaces/(${NAME})/plugins/(${NAME})/update$`);

export function createMarketplaceRoutes(deps: MarketplaceRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/marketplaces" && !path.startsWith("/api/marketplaces/")) return PASS;
    res.setHeader("cache-control", "private, no-store");
    setCapabilityDeprecationHeaders(res, "/api/installation/capabilities");
    const fail = (error: unknown) => {
      if (error instanceof MarketplaceError) return json(res, error.status, { error: error.message, code: error.code });
      if (error instanceof Error && error.name === "GithubCredentialsError") {
        const known = error as Error & { status: number; code: string };
        return json(res, known.status, { error: known.message, code: known.code });
      }
      throw error;
    };
    const viewer = deps.viewer?.(auth) ?? { seesAll: true };
    const views = () => {
      const sources = deps.workspace?.workspaceTokenSources() ?? new Set<string>();
      const who = deps.actor(auth);
      return deps.store.list(viewer).map((market) => {
        if (!deps.workspace) return market;
        const credential = deps.workspace.workspaceCredential?.(market.source, who);
        return { ...market, hasToken: sources.has(market.source), ...(credential ? { credential } : {}) };
      });
    };
    const list = () => json(res, 200, { marketplaces: views() });
    /** A private marketplace that is not this viewer's does not exist to them. */
    const unreachable = (name: string) => method !== "GET" && typeof deps.store.canAccess === "function" && !deps.store.canAccess(name, viewer);
    if (method !== "GET" && !deps.mayManage(auth)) {
      return json(res, 403, { error: "forbidden: only an admin or this computer's owner can change marketplaces", code: "marketplaces_owner_only" });
    }
    if (method !== "GET" && method !== "DELETE" && !/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
      return json(res, 415, { error: "content-type must be application/json" });
    }
    try {
      if (path === "/api/marketplaces") {
        if (method === "GET") return list();
        if (method !== "POST") return json(res, 405, { error: "GET or POST" });
        const body = await readBody(req) as Record<string, unknown> | null;
        const source = typeof body?.source === "string" ? body.source.trim() : "";
        const ref = typeof body?.ref === "string" && body.ref.trim() ? body.ref.trim() : undefined;
        if (!source || source.length > 500) return json(res, 400, { error: "Enter owner/repo, an https git address or the address of a marketplace.json." });
        const visibility = visibilityField(body?.visibility);
        if (visibility === null) return json(res, 400, { error: "visibility must be \"private\" or \"org\".", code: "invalid_visibility" });
        if (visibility === "org" && deps.mayShareOrgWide && !deps.mayShareOrgWide(auth)) {
          return json(res, 403, { error: "Only an administrator can share a marketplace with the whole organization.", code: "marketplace_org_admin_only" });
        }
        const credential = typeof body?.credential === "string" && CREDENTIAL.test(body.credential) ? body.credential : undefined;
        if (body?.credential !== undefined && body?.credential !== null && body?.credential !== "" && !credential) {
          return json(res, 400, { error: "credential must be the id of a credential.", code: "invalid_credential" });
        }
        const actor = deps.actor(auth);
        const added: MarketplaceView = deps.workspace
          ? await deps.workspace.addWorkspaceMarketplace({ source, ...(ref ? { ref } : {}), ...(credential ? { credential } : {}), ...(visibility ? { visibility } : {}) }, actor)
          : await deps.store.add({ source, ...(ref ? { ref } : {}) }, actor, { viewer, ...(visibility ? { visibility } : {}) });
        const marketplaces = views();
        return json(res, 201, { marketplace: marketplaces.find((market) => market.name === added.name) ?? added, marketplaces });
      }
      const update = UPDATE.exec(path);
      if (update) {
        if (method !== "POST") return json(res, 405, { error: "POST" });
        const [, marketplace, name] = update;
        if (unreachable(marketplace!)) return json(res, 404, { error: "No marketplace with that name.", code: "not_found" });
        const before = deps.store.installed().find((entry) => entry.key === `${name}@${marketplace}`);
        if (!before) return json(res, 404, { error: "That plugin is not installed.", code: "not_installed" });
        const done = await deps.update(marketplace!, name!, { req, auth });
        if (done.status < 400) {
          const after = deps.store.installed().find((entry) => entry.key === `${name}@${marketplace}`);
          const revisionOf = (entry: typeof before | undefined) => ({
            ...(entry?.version ? { version: entry.version } : {}),
            ...(entry?.revision ? { revision: entry.revision.slice(0, 80) } : {}),
          });
          deps.audit(auth, {
            action: "plugin.update",
            target: { kind: "plugin", id: `${name}@${marketplace}`, name: name! },
            before: { ...revisionOf(before), servers: before.servers, skills: before.skills },
            after: { ...revisionOf(after), servers: after?.servers ?? [], skills: after?.skills ?? [] },
          });
        }
        return json(res, done.status, { ...done.body, marketplaces: views() });
      }
      const plugin = PLUGIN.exec(path);
      if (plugin) {
        const [, marketplace, name] = plugin;
        if (unreachable(marketplace!)) return json(res, 404, { error: "No marketplace with that name.", code: "not_found" });
        if (method === "POST") {
          const done = await deps.install(marketplace!, name!, { req, auth });
          return json(res, done.status, { ...done.body, marketplaces: views() });
        }
        if (method === "DELETE") {
          const done = await deps.uninstall(marketplace!, name!);
          return json(res, done.status, { ...done.body, marketplaces: views() });
        }
        return json(res, 405, { error: "POST or DELETE" });
      }
      const market = MARKET.exec(path);
      if (market) {
        const [, name, action] = market;
        if (unreachable(name!)) return json(res, 404, { error: "No marketplace with that name.", code: "not_found" });
        if (action === "refresh" && method === "POST") {
          if (deps.workspace) await deps.workspace.refreshWorkspaceMarketplace(name!, deps.actor(auth));
          else await deps.store.refresh(name!, deps.actor(auth), { viewer });
          return list();
        }
        if (action === "visibility") {
          if (method !== "PUT") return json(res, 405, { error: "PUT" });
          const body = await readBody(req) as Record<string, unknown> | null;
          const visibility = visibilityField(body?.visibility);
          if (!visibility) return json(res, 400, { error: "visibility must be \"private\" or \"org\".", code: "invalid_visibility" });
          if (visibility === "org" && deps.mayShareOrgWide && !deps.mayShareOrgWide(auth)) {
            return json(res, 403, { error: "Only an administrator can share a marketplace with the whole organization.", code: "marketplace_org_admin_only" });
          }
          const before = deps.store.record(name!);
          const changed = await deps.store.setVisibility(name!, visibility, viewer);
          deps.audit(auth, {
            action: "marketplace.visibility",
            target: { kind: "marketplace", id: name!, name: name! },
            ...(before ? { before: { visibility: before.visibility ?? "private" } } : {}),
            after: { visibility: changed.visibility },
          });
          return list();
        }
        if (action === "credential") {
          if (!deps.workspace?.chooseWorkspaceMarketplaceCredential) return json(res, 404, { error: "not found" });
          if (method !== "PUT") return json(res, 405, { error: "PUT" });
          const body = await readBody(req) as Record<string, unknown> | null;
          const sent = body?.credential;
          if (sent !== null && (typeof sent !== "string" || !CREDENTIAL.test(sent))) {
            return json(res, 400, { error: "send { credential: id } or { credential: null } for Automatic", code: "invalid_credential" });
          }
          deps.workspace.chooseWorkspaceMarketplaceCredential(name!, sent, deps.actor(auth));
          deps.audit(auth, { action: "marketplace.credential", target: { kind: "marketplace", id: name!, name: name! }, after: { scope: "workspace", credential: sent ?? "automatic" } });
          return list();
        }
        if (!action && method === "DELETE") {
          if (deps.workspace) await deps.workspace.removeWorkspaceMarketplace(name!);
          else await deps.store.remove(name!, viewer);
          return list();
        }
        return json(res, 405, { error: "method not allowed" });
      }
      return json(res, 404, { error: "not found" });
    } catch (error) {
      return fail(error);
    }
  };
}
