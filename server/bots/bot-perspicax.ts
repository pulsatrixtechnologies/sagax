// The Perspicax MCP profiles a bot mounts (slice 5), on an organization
// server linked to Perspicax:
//
//   GET /api/bots/:id/perspicax   { selected, available, canEdit }
//   PUT /api/bots/:id/perspicax   { profiles: [<profile id>] }
//
// Reading needs bot.use, changing needs bot.edit (server/auth/authz.ts). Each
// person who talks to the bot uses their own Perspicax access
// (server/perspicax/perspicax-mcp.ts), so the list only says which profiles the bot
// offers. Adding a profile needs holding it now (a bot editor never offers a
// profile they cannot use themselves); a profile someone else put there may
// stay, and may be removed by anyone who edits the bot.
//
// Spec: docs/superpowers/specs/2026-09-29-perspicax-multiuser-design.md,
// section 4 ("Quel profil, pour qui"), decision D4 of the slice 5 plan.
import { canOnBot, type BotFacts, type Viewer } from "../auth/authz.ts";
import type { DirectoryProfile } from "../perspicax/perspicax-link.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";
import { MAX_BOT_PERSPICAX_PROFILES } from "../store.ts";

const PROFILE_ID = /^[0-9A-Za-z_.:-]{1,64}$/;

export interface WirePerspicaxProfile {
  id: string;
  slug: string;
  name: string;
  description: string;
}

export interface BotPerspicaxRouteDeps {
  /** False while the server has no Perspicax link: the routes do not exist. */
  linked(): boolean;
  /** The bot's current profile ids, or undefined when there is no such bot. */
  profilesOf(botId: string): string[] | undefined;
  facts(botId: string): BotFacts;
  viewer(auth: RequestAuth): Viewer | undefined;
  /** The profile ids the caller holds in Perspicax now (directory). */
  heldBy(auth: RequestAuth): string[];
  /** Every profile Perspicax lists. */
  catalog(): DirectoryProfile[];
  setProfiles(botId: string, profiles: string[]): void;
  onChanged(botId: string): void;
}

function describe(id: string, catalog: ReadonlyMap<string, DirectoryProfile>): WirePerspicaxProfile {
  const known = catalog.get(id);
  return known
    ? { id, slug: known.slug, name: known.name || known.slug || id, description: known.description }
    : { id, slug: "", name: id, description: "" };
}

export function createBotPerspicaxRoutes(deps: BotPerspicaxRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const match = path.match(/^\/api\/bots\/([\w-]+)\/perspicax$/);
    if (!match || !deps.linked()) return PASS;
    const botId = match[1]!;
    const reply = (status: number, body: unknown) => json(res, status, body);
    if (method !== "GET" && method !== "PUT") return reply(405, { error: "method not allowed" });
    const current = deps.profilesOf(botId);
    if (!current) return reply(404, { error: "no such bot" });
    const viewer = deps.viewer(auth);
    const facts = deps.facts(botId);
    // Like other bot reads: a bot the caller may not use does not exist.
    if (!canOnBot(viewer, "bot.use", facts)) return reply(404, { error: "no such bot" });
    const canEdit = canOnBot(viewer, "bot.edit", facts);
    const catalog = new Map(deps.catalog().map((profile) => [profile.id, profile] as const));
    const answer = (profiles: readonly string[]) => {
      const held = new Set(deps.heldBy(auth));
      res.setHeader("cache-control", "no-store");
      return reply(200, {
        selected: profiles.map((id) => ({ ...describe(id, catalog), heldByMe: held.has(id) })),
        available: [...catalog.values()].filter((profile) => held.has(profile.id)).map((profile) => describe(profile.id, catalog)),
        canEdit,
      });
    };
    if (method === "GET") return answer(current);

    if (!canEdit) return reply(403, { error: "changing this bot's Perspicax tools needs edit on the bot", code: "needs_edit" });
    const body = await readBody(req);
    const list = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).profiles : undefined;
    if (!Array.isArray(list) || !list.every((id): id is string => typeof id === "string" && PROFILE_ID.test(id))) {
      return reply(400, { error: "send { profiles: [<profile id>] }", code: "bad_profiles" });
    }
    const next = [...new Set(list)];
    if (next.length > MAX_BOT_PERSPICAX_PROFILES) {
      return reply(400, { error: `a bot mounts at most ${MAX_BOT_PERSPICAX_PROFILES} Perspicax profiles`, code: "too_many_profiles" });
    }
    const added = next.filter((id) => !current.includes(id));
    if (added.some((id) => !catalog.has(id))) return reply(400, { error: "Perspicax lists no such profile", code: "unknown_profile" });
    const held = new Set(deps.heldBy(auth));
    if (added.some((id) => !held.has(id))) {
      return reply(403, { error: "you can only add a Perspicax profile you hold", code: "profile_not_held" });
    }
    deps.setProfiles(botId, next);
    console.log(`[perspicax] bot ${botId}: MCP profiles set (${next.length}; ${added.length} added, ${current.filter((id) => !next.includes(id)).length} removed)`);
    deps.onChanged(botId);
    return answer(deps.profilesOf(botId) ?? next);
  };
}
