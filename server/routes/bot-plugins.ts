// A bot's Claude Code plugins (Connect apps, scope "For this bot",
// server/bot-plugins.ts). The marketplaces are the installation's one list.
//
//   GET    /api/bots/:id/plugins
//          { marketplaces: [MarketplaceListing], plugins: [InstalledBotPlugin], policy, engine }
//   POST   /api/bots/:id/plugins/marketplaces { source, ref?, token? }  add (or refresh) one, for everyone's list;
//          a token is tried first and saved (encrypted) for this bot once the clone works
//   POST   /api/bots/:id/plugins/marketplaces/:name/update
//   PUT    /api/bots/:id/plugins/marketplaces/:name/token { token }   save or replace this bot's token
//   DELETE /api/bots/:id/plugins/marketplaces/:name/token             forget it
//   DELETE /api/bots/:id/plugins/marketplaces/:name                  this bot's plugins from it (and its token); the
//          marketplace too when the caller may remove it (an admin, or who added it) and nothing uses it
//   POST   /api/bots/:id/plugins/install { marketplace, plugin }     install or update
//   PATCH  /api/bots/:id/plugins/:key { enabled }
//   PUT    /api/bots/:id/plugins/:key/config { values }   the plugin's declared
//          fields (server/plugin-config.ts); a secret field answers 400 sensitive_field
//   DELETE /api/bots/:id/plugins/:key
//
// Reads need use on the bot; every change needs its owner or manage (an
// organization admin too). A refusal from the git host answers its real
// cause (`code`: private_needs_token, bad_token, sso_required, rate_limited,
// not_found_or_no_access, forbidden) and `fix`, never a token. Member scope (request-auth.ts CLIENT_ALLOW).
// Perspicax `sagax_integrations: off` (server/person-integrations.ts): the
// listing says `managedByAdmin: true` with `canChange: false`, and every
// change answers 403 `org_integrations_admin_only`, even on their own bot.
import type { BotPluginError, BotPlugins, MarketplacePolicy } from "../bot-plugins.ts";
import { INTEGRATIONS_ADMIN_ONLY } from "../person-integrations.ts";
import type { MarketplaceViewer, MarketplaceVisibility } from "../plugin-marketplaces.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface BotPluginRouteDeps<B extends { id: string }> {
  plugins: BotPlugins;
  bot: (id: string) => B | undefined;
  mayRead: (auth: RequestAuth, bot: B) => boolean;
  mayChange: (auth: RequestAuth, bot: B) => boolean;
  /** Who acts: their own GitHub connection reads a private marketplace. */
  actor: (auth: RequestAuth) => string | undefined;
  /** Who is asking: a private marketplace is listed to its author only.
   * Absent: unfiltered (a solo server, or a test fixture). */
  viewer?: (auth: RequestAuth) => MarketplaceViewer;
  /** May this caller share a marketplace with the whole organization? Org-wide
   * is admins only (mirror of routes/marketplaces.ts); absent: allowed. */
  mayShareOrgWide?: (auth: RequestAuth) => boolean;
  /** An admin manages this person's plugins (never an organization admin). */
  managedByAdmin?: (auth: RequestAuth) => boolean;
  /** May remove a marketplace from the one list (the workspace's managers). */
  mayManageMarketplaces?: (auth: RequestAuth) => boolean;
  policy: () => MarketplacePolicy | undefined;
  /** Whether the bot's engine loads plugin skills and commands. */
  engineLoadsPlugins: (bot: B) => boolean;
  /** After a change: the bot's next turn starts a fresh engine process. */
  changed?: (bot: B, action: string, detail: Record<string, unknown>, auth: RequestAuth) => void;
}

const ROUTE = /^\/api\/bots\/([\w-]+)\/plugins(?:\/(marketplaces|install)(?:\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})(?:\/(update|token))?)?|\/([A-Za-z0-9][A-Za-z0-9._-]{0,63}@[A-Za-z0-9][A-Za-z0-9._-]{0,63})(\/config)?)?$/;
const TOKEN = /^[\x21-\x7e]{8,4096}$/;

function tokenField(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !TOKEN.test(value.trim())) return null;
  return value.trim();
}

function isPluginError(error: unknown): error is BotPluginError {
  return error instanceof Error && typeof (error as { status?: unknown }).status === "number" && typeof (error as { code?: unknown }).code === "string";
}

export function createBotPluginRoutes<B extends { id: string }>(deps: BotPluginRouteDeps<B>): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (!path.startsWith("/api/bots/") || !path.includes("/plugins")) return PASS;
    const match = ROUTE.exec(decodeURIComponent(path));
    if (!match) return PASS;
    const [, botId, section, name, update, key, config] = match;
    const bot = deps.bot(botId!);
    if (!bot || !deps.mayRead(auth, bot)) return json(res, 404, { error: "no such bot" });
    res.setHeader("cache-control", "private, no-store");
    const managedByAdmin = deps.managedByAdmin?.(auth) === true;
    const marketViewer = deps.viewer?.(auth) ?? { seesAll: true };
    /** A private marketplace that is not this viewer's does not exist to them. */
    const marketplaceUnreachable = (marketName: string) =>
      typeof deps.plugins.canAccessMarketplace === "function" && !deps.plugins.canAccessMarketplace(marketName, marketViewer);
    const listing = () => ({
      marketplaces: deps.plugins.listMarketplaces(bot.id, marketViewer),
      plugins: deps.plugins.listPlugins(bot.id),
      policy: deps.policy() ?? { mode: "any" },
      engine: { loadsPlugins: deps.engineLoadsPlugins(bot) },
      canChange: !managedByAdmin && deps.mayChange(auth, bot),
      ...(managedByAdmin ? { managedByAdmin: true } : {}),
    });
    if (!section && !key) {
      if (method !== "GET") return json(res, 405, { error: "GET only" });
      return json(res, 200, listing());
    }
    if (managedByAdmin) return json(res, 403, { ...INTEGRATIONS_ADMIN_ONLY });
    if (!deps.mayChange(auth, bot)) return json(res, 403, { error: "Only the bot's owner, or someone who manages it, can change its plugins.", code: "plugins_owner_only" });
    const body = method === "DELETE" || update === "update" ? null : await (async () => {
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) return undefined;
      return readBody(req) as Promise<Record<string, unknown> | null>;
    })();
    if (body === undefined) return json(res, 415, { error: "content-type must be application/json" });
    const actor = deps.actor(auth);
    try {
      if (section === "marketplaces" && !name) {
        if (method !== "POST") return json(res, 405, { error: "POST only" });
        const source = typeof body?.source === "string" ? body.source : "";
        const ref = typeof body?.ref === "string" && body.ref.trim() ? body.ref.trim() : undefined;
        if (!source.trim() || source.length > 500) return json(res, 400, { error: "send { source: owner/repo or an https git URL }", code: "invalid_source" });
        const token = tokenField(body?.token);
        if (token === null) return json(res, 400, { error: "The token must be one line of printable characters.", code: "invalid_token" });
        const visibility = body?.visibility === "private" || body?.visibility === "org" ? body.visibility as MarketplaceVisibility : undefined;
        if (visibility === "org" && deps.mayShareOrgWide && !deps.mayShareOrgWide(auth)) {
          return json(res, 403, { error: "Only an administrator can share a marketplace with the whole organization.", code: "marketplace_org_admin_only" });
        }
        const added = await deps.plugins.addMarketplace(bot.id, { source, ...(ref ? { ref } : {}), ...(token ? { token } : {}), ...(visibility ? { visibility } : {}) }, actor);
        deps.changed?.(bot, "plugin.marketplace_add", { marketplace: added.name, source: added.source }, auth);
        return json(res, 201, { marketplace: added, ...listing() });
      }
      if (section === "marketplaces" && name && marketplaceUnreachable(name)) {
        return json(res, 404, { error: "No marketplace with that name.", code: "not_found" });
      }
      if (section === "marketplaces" && name && update === "token") {
        if (method === "DELETE") {
          const market = deps.plugins.setMarketplaceToken(bot.id, name, null, actor);
          deps.changed?.(bot, "plugin.marketplace_token_remove", { marketplace: name }, auth);
          return json(res, 200, { marketplace: market, ...listing() });
        }
        if (method !== "PUT") return json(res, 405, { error: "PUT or DELETE" });
        const token = tokenField(body?.token);
        if (!token) return json(res, 400, { error: "send { token }: one line of printable characters", code: "invalid_token" });
        const market = deps.plugins.setMarketplaceToken(bot.id, name, token, actor);
        deps.changed?.(bot, "plugin.marketplace_token_set", { marketplace: name }, auth);
        return json(res, 200, { marketplace: market, ...listing() });
      }
      if (section === "marketplaces" && name) {
        if (update) {
          if (method !== "POST") return json(res, 405, { error: "POST only" });
          const refreshed = await deps.plugins.updateMarketplace(bot.id, name, actor);
          return json(res, 200, { marketplace: refreshed, ...listing() });
        }
        if (method !== "DELETE") return json(res, 405, { error: "DELETE only" });
        const removed = await deps.plugins.removeMarketplace(bot.id, name, { ...(actor ? { actor } : {}), mayManage: deps.mayManageMarketplaces?.(auth) === true });
        deps.changed?.(bot, "plugin.marketplace_remove", { marketplace: name, sharedRemoved: removed.sharedRemoved }, auth);
        return json(res, 200, { ...listing(), sharedRemoved: removed.sharedRemoved });
      }
      if (section === "install") {
        if (method !== "POST") return json(res, 405, { error: "POST only" });
        const marketplace = typeof body?.marketplace === "string" ? body.marketplace : "";
        const plugin = typeof body?.plugin === "string" ? body.plugin : "";
        if (!marketplace || !plugin) return json(res, 400, { error: "send { marketplace, plugin }", code: "invalid_plugin" });
        if (marketplaceUnreachable(marketplace)) return json(res, 404, { error: "No marketplace with that name.", code: "not_found" });
        const installed = await deps.plugins.install(bot.id, { marketplace, plugin }, actor);
        deps.changed?.(bot, "plugin.install", { plugin: installed.key, removed: installed.removed }, auth);
        return json(res, 201, { plugin: installed, ...listing() });
      }
      if (key && config) {
        if (method !== "PUT") return json(res, 405, { error: "PUT only" });
        const plugin = await deps.plugins.setPluginConfig(bot.id, key, body?.values);
        deps.changed?.(bot, "plugin.config", { plugin: key, fields: Object.keys(plugin.config?.values ?? {}) }, auth);
        return json(res, 200, { plugin, ...listing() });
      }
      if (key) {
        if (method === "PATCH") {
          if (!body || typeof body.enabled !== "boolean" || Object.keys(body).length !== 1) return json(res, 400, { error: "Only { enabled } can be changed here." });
          const plugin = deps.plugins.setEnabled(bot.id, key, body.enabled);
          deps.changed?.(bot, "plugin.toggle", { plugin: key, enabled: body.enabled }, auth);
          return json(res, 200, { plugin, ...listing() });
        }
        if (method === "DELETE") {
          await deps.plugins.uninstall(bot.id, key);
          deps.changed?.(bot, "plugin.uninstall", { plugin: key }, auth);
          return json(res, 200, listing());
        }
        return json(res, 405, { error: "PATCH or DELETE" });
      }
      return json(res, 404, { error: "not found" });
    } catch (error) {
      if (isPluginError(error)) return json(res, error.status, { error: error.message, code: error.code, ...(error.fix ? { fix: error.fix } : {}) });
      const tokenStatus = (error as { status?: unknown; code?: unknown })?.status;
      if (error instanceof Error && error.name === "MarketplaceTokenError" && typeof tokenStatus === "number") {
        return json(res, tokenStatus, { error: error.message, code: (error as { code?: string }).code });
      }
      throw error;
    }
  };
}
