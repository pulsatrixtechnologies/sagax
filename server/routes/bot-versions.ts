// A bot's versions: the profile history (profile-versions.ts) read as a list
// of versions, and a restore of one whole version. 2026-10-15: Changes is
// a version history (date, who, what changed, a comparison with the current
// version, and "Restore this version").
//
// POST /api/bots/:id/history/restore, body { id, expectedRevision }: every
// field changed after that version goes back to its value at that version.
// The restore is itself recorded as a change (via "restore"), so it is a new
// version that can be restored away in turn. Only the bot's owner or an
// admin may restore; the scope rule (admin, like the other history routes)
// is keyed by path in server/auth/request-auth.ts.
//
// The history keeps the full text of the Personality only. The other text
// fields keep a one-line copy of at most 200 characters, and the working
// folder is not restored from here: a value the history cannot give back
// exactly is left as it is and named in the answer (`skipped`).
import type { HistoryRow } from "../profile-versions.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { versionRestorePlan, type VersionRestorePatch } from "../../shared/bot-versions.ts";
import { PASS, type RouteHandler } from "./table.ts";

export { versionRestorePlan, type VersionRestorePatch };

export interface BotVersionRouteDeps {
  /** The bot, or undefined when there is none. */
  exists(botId: string): boolean;
  /** Whether this caller is the bot's owner or an admin. */
  ownerOrAdmin(auth: RequestAuth, botId: string): boolean;
  /** Lands the queued history rows, then reads them oldest first. */
  rows(botId: string): Promise<HistoryRow[]>;
  /** The bot's current profile revision. */
  revision(botId: string): string | null;
  /** Writes the patch, records it as a "restore" change, broadcasts the
   * bot; returns its wire form, or an error. */
  apply(auth: RequestAuth, botId: string, patch: VersionRestorePatch): { bot: unknown } | { status: number; error: string };
}

export function createBotVersionRoutes(deps: BotVersionRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const m = path.match(/^\/api\/bots\/([\w-]+)\/history\/restore$/);
    if (!m || method !== "POST") return PASS;
    const botId = m[1]!;
    const body = await readBody(req);
    if (!deps.exists(botId)) return json(res, 404, { error: "no such bot" });
    if (!deps.ownerOrAdmin(auth, botId)) {
      return json(res, 403, { error: "forbidden: only the bot owner or an admin can restore a version", code: "bot_restore_owner_only" });
    }
    const versionId = typeof body?.id === "string" ? body.id : "";
    if (!versionId) return json(res, 400, { error: "id is required" });
    const rows = await deps.rows(botId);
    if (body?.expectedRevision !== deps.revision(botId)) {
      return json(res, 409, { error: "This bot's profile changed; reload history before restoring" });
    }
    const plan = versionRestorePlan(rows, versionId);
    if (!plan.ok) return json(res, plan.status, { error: plan.error });
    if (Object.keys(plan.patch).length === 0) {
      return json(res, 400, { error: "Nothing in this version can be restored exactly.", skipped: plan.skipped });
    }
    const applied = deps.apply(auth, botId, plan.patch);
    if ("error" in applied) return json(res, applied.status, { error: applied.error });
    return json(res, 200, { ...applied, restored: Object.keys(plan.patch), skipped: plan.skipped });
  };
}
