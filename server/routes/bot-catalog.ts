// The organisation bot catalogue ("Browse Bots", src/components/bot-catalog/).
//
//   GET  /api/bot-catalog
//        { organization, viewer, entries }: the viewer's own bots (archived
//        included, flagged), the bots shared with them, and the bots
//        published to the organisation. Never another person's private bot.
//   GET  /api/bot-catalog/:id
//        { entry, soul, memories, skills, routines, integrations }: read only.
//        Memories only for a bot the viewer owns or that is shared with them.
//   PUT  /api/bot-catalog/:id/listing  { published, category?, featured? }
//        Publish to (or withdraw from) the organisation catalogue: the
//        bot's owner or an organisation admin; only an admin features one.
//   POST /api/bot-catalog/:id/import   { name? }
//        A copy for the viewer (the console's clone: soul, skills, model
//        and settings; no threads, memory, grants or routines), from a bot
//        they own, one shared with them, or one published to the organisation.
//        A member's copy (anyone not an organisation admin) drops what
//        stays an admin's on the shared server (memberImportReset: working
//        folder, browser profile, MCP servers but the remote ones of their
//        own bot); an admin's keeps everything.
//
// Organisation server only for the shared and published parts: a solo
// server lists its own bots and refuses a listing. Member scope
// (request-auth.ts CLIENT_ALLOW); every rule is checked here. Publishing,
// withdrawing, featuring and importing are rows of the admin activity log.
import type { Level } from "../auth/authz.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import {
  normalizeCatalogCategory,
  type BotCatalogDetail,
  type BotCatalogEntry,
  type BotCatalogListing,
  type BotCatalogLook,
  type BotCatalogResponse,
  type BotCatalogSource,
} from "../../shared/bot-catalog.ts";
import { PASS, type RouteHandler } from "./table.ts";

const NAME_MAX = 80;

export interface CatalogBot {
  id: string;
  name: string;
  title: string;
  description: string;
  look: BotCatalogLook;
  ownerPrincipalId: string;
  archived: boolean;
  primary: boolean;
  catalog?: BotCatalogListing;
}

export interface CatalogViewer {
  principalId: string;
  admin: boolean;
  canCreate: boolean;
  /** A Perspicax admin lets this person use shared bots only. */
  botsReadOnly: boolean;
  /** 2026-10-09: features bots in the catalogue (an admin, or a profile
   * with bots.catalogFeature). Absent: admins only. */
  feature?: boolean;
}

export interface CatalogAuditRow {
  action: "bot.catalog_publish" | "bot.catalog_unpublish" | "bot.catalog_update" | "bot.catalog_import";
  target: { kind: "bot"; id: string; name: string };
  changed?: string[];
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface BotCatalogRouteDeps {
  organization(): boolean;
  bots(): CatalogBot[];
  /** Null: no person behind the request (a local service). */
  viewer(auth: RequestAuth): CatalogViewer | null;
  /** The viewer's level on a bot (server/auth/authz.ts botLevel). */
  level(auth: RequestAuth, botId: string): Level | "owner" | null;
  personName(principalId: string): string;
  detail(botId: string, options: { memories: boolean }): Omit<BotCatalogDetail, "entry"> | null;
  setListing(botId: string, listing: BotCatalogListing | null): void;
  /** `asMember`: reset the copy with memberImportReset. `ownSource`: the
   * copy is of the viewer's own bot, so its remote MCP servers may stay. */
  clone(botId: string, input: { ownerPrincipalId: string; name?: string; asMember: boolean; ownSource: boolean }): Promise<string>;
  audit(auth: RequestAuth, row: CatalogAuditRow): void;
  now?(): number;
}

/** How this viewer reaches a bot, or null when the catalogue must not show
 * it: their own (archived too), shared with them, or published to the
 * organisation (neither archived). On a solo server only their own. */
export function catalogSource(bot: Pick<CatalogBot, "archived" | "catalog">, level: Level | "owner" | null, organization: boolean): BotCatalogSource | null {
  if (level === "owner") return "mine";
  if (!organization || bot.archived) return null;
  if (level) return "shared";
  if (bot.catalog?.published) return "organization";
  return null;
}

function entryOf(bot: CatalogBot, source: BotCatalogSource, ownerName: string, organization: boolean): BotCatalogEntry {
  return {
    id: bot.id,
    name: bot.name,
    title: bot.title,
    description: bot.description,
    look: bot.look,
    owner: { principalId: bot.ownerPrincipalId, name: ownerName },
    source,
    archived: bot.archived,
    primary: bot.primary,
    ...(organization && bot.catalog?.published ? { catalog: bot.catalog } : {}),
  };
}

/** The fields of a member's imported copy that stay an admin's: the
 * working folder and the server's browser profiles (dossiers and signed-in
 * sessions on the shared server) and MCP servers. 2026-10-26: what the
 * bot does in the person's own environment is theirs, so the computer
 * (only Off travels; any other value reads as Auto, server/surface.ts), the
 * browser and the Always allow list stay. MCP servers stay only when the
 * copy is of the person's own bot (`keep`) and only the remote (url) ones:
 * a stdio server runs on the organization's server. Engine, model, soul,
 * skills and the Perspicax profile list stay too. */
export function memberImportReset(keep?: { mcpServers?: readonly string[]; remote: (name: string) => boolean }): {
  browserProfile: undefined;
  cwd: undefined;
  mcpServers: string[];
} {
  const mcpServers = keep ? (keep.mcpServers ?? []).filter((name) => keep.remote(name)) : [];
  return { browserProfile: undefined, cwd: undefined, mcpServers };
}

const ROUTE = /^\/api\/bot-catalog(?:\/([\w-]+)(?:\/(listing|import))?)?$/;

export function createBotCatalogRoutes(deps: BotCatalogRouteDeps): RouteHandler {
  const now = () => deps.now?.() ?? Date.now();
  const find = (auth: RequestAuth, botId: string) => {
    const bot = deps.bots().find((candidate) => candidate.id === botId);
    if (!bot) return null;
    const level = deps.level(auth, bot.id);
    const source = catalogSource(bot, level, deps.organization());
    return source ? { bot, level, source } : null;
  };

  return async ({ req, res, path, method, auth, json, readBody }) => {
    const m = ROUTE.exec(path);
    if (!m) return PASS;
    const [, botId, action] = m;
    res.setHeader("cache-control", "private, no-store");
    const viewer = deps.viewer(auth);
    if (!viewer) return json(res, 403, { error: "forbidden: the catalogue is for a person", code: "catalog_person_only" });
    const organization = deps.organization();

    if (!botId) {
      if (method !== "GET") return json(res, 405, { error: "GET only" });
      const entries: BotCatalogEntry[] = [];
      for (const bot of deps.bots()) {
        const source = catalogSource(bot, deps.level(auth, bot.id), organization);
        if (source) entries.push(entryOf(bot, source, deps.personName(bot.ownerPrincipalId), organization));
      }
      const body: BotCatalogResponse = {
        organization,
        viewer: { principalId: viewer.principalId, admin: organization && viewer.admin, canCreate: viewer.canCreate && !viewer.botsReadOnly },
        entries,
      };
      return json(res, 200, body);
    }

    const found = find(auth, botId);
    if (!found) return json(res, 404, { error: "No such bot in your catalogue." });
    const { bot, level, source } = found;

    if (!action) {
      if (method !== "GET") return json(res, 405, { error: "GET only" });
      const detail = deps.detail(bot.id, { memories: source !== "organization" });
      if (!detail) return json(res, 404, { error: "No such bot in your catalogue." });
      const body: BotCatalogDetail = { entry: entryOf(bot, source, deps.personName(bot.ownerPrincipalId), organization), ...detail };
      return json(res, 200, body);
    }

    if (action === "listing") {
      if (method !== "PUT") return json(res, 405, { error: "PUT only" });
      if (!organization) return json(res, 409, { error: "not_organization", message: "The catalogue is shared on an organization server only." });
      const raw = await readBody(req, 4_096);
      const body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
      const extra = body ? Object.keys(body).find((key) => key !== "published" && key !== "category" && key !== "featured") : undefined;
      if (!body || extra || typeof body.published !== "boolean"
        || (body.featured !== undefined && typeof body.featured !== "boolean")
        || (body.category !== undefined && body.category !== null && typeof body.category !== "string")) {
        return json(res, 400, { error: extra ? `Unknown field ${extra}.` : "Send { \"published\": true or false, \"category\"?: text, \"featured\"?: true or false }." });
      }
      if (level !== "owner" && !viewer.admin) return json(res, 403, { error: "catalog_owner_only", message: "Only the bot's owner or an organization admin can publish it." });
      const before = bot.catalog?.published ? bot.catalog : null;
      if (body.featured !== undefined && body.featured !== (before?.featured === true) && !viewer.admin && viewer.feature !== true) {
        return json(res, 403, { error: "catalog_feature_admin", message: "Only an organization admin can feature a bot.", permission: "bots.catalogFeature" });
      }
      if (body.published && bot.archived) return json(res, 409, { error: "archived", message: "Restore this bot before publishing it." });
      if (!body.published) {
        if (before) {
          deps.setListing(bot.id, null);
          deps.audit(auth, { action: "bot.catalog_unpublish", target: { kind: "bot", id: bot.id, name: bot.name }, changed: ["catalog"],
            before: { category: before.category ?? null, featured: before.featured === true }, after: { published: false } });
        }
        return json(res, 200, { catalog: null });
      }
      const category = body.category === undefined ? before?.category ?? null : normalizeCatalogCategory(body.category);
      const featured = body.featured ?? before?.featured === true;
      const next: BotCatalogListing = {
        published: true,
        ...(category ? { category } : {}),
        ...(featured ? { featured: true } : {}),
        publishedAt: before?.publishedAt ?? now(),
        publishedBy: before?.publishedBy ?? viewer.principalId,
      };
      const changed = [
        ...(!before ? ["published"] : []),
        ...((before?.category ?? null) !== (next.category ?? null) ? ["category"] : []),
        ...((before?.featured === true) !== featured ? ["featured"] : []),
      ];
      if (changed.length) {
        deps.setListing(bot.id, next);
        deps.audit(auth, {
          action: before ? "bot.catalog_update" : "bot.catalog_publish",
          target: { kind: "bot", id: bot.id, name: bot.name },
          changed,
          ...(before ? { before: { category: before.category ?? null, featured: before.featured === true } } : {}),
          after: { category: next.category ?? null, featured },
        });
      }
      return json(res, 200, { catalog: changed.length ? next : before });
    }

    // import
    if (method !== "POST") return json(res, 405, { error: "POST only" });
    if (viewer.botsReadOnly) return json(res, 403, { error: "org_bots_read_only", message: "Your administrator lets you use shared bots only." });
    if (!viewer.canCreate) return json(res, 403, { error: "forbidden: you cannot create bots on this server", code: "create_bots_not_allowed" });
    const raw = await readBody(req, 4_096);
    const body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const extra = Object.keys(body).find((key) => key !== "name");
    if (extra) return json(res, 400, { error: `Unknown field ${extra}.` });
    let name: string | undefined;
    if (body.name !== undefined && body.name !== null) {
      if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > NAME_MAX) return json(res, 400, { error: `name is 1 to ${NAME_MAX} characters.` });
      name = body.name.trim();
    }
    let copyId: string;
    try {
      copyId = await deps.clone(bot.id, { ownerPrincipalId: viewer.principalId, ...(name ? { name } : {}), asMember: !viewer.admin, ownSource: source === "mine" });
    } catch (error) {
      const status = (error as { status?: unknown })?.status;
      if (typeof status === "number" && status >= 400 && status < 500) {
        return json(res, status, { error: error instanceof Error ? error.message : "This bot could not be copied." });
      }
      throw error;
    }
    deps.audit(auth, { action: "bot.catalog_import", target: { kind: "bot", id: copyId, name: name ?? bot.name }, after: { from: bot.id, source, ownerPrincipalId: viewer.principalId, memberDefaults: !viewer.admin } });
    return json(res, 201, { botId: copyId });
  };
}
