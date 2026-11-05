/**
 * PATCH /api/bots/:id/profile (#1388 B1).
 * Own match scratch. Never imports server/index.ts.
 */
import { atLeast } from "../auth/authz.ts";
import { parseBotProfilePatch } from "../bots/bot-profile.ts";
import { profileSnapshot } from "../profiles/profile-revision.ts";
import { recordProfileChange } from "../profiles/profile-versions.ts";

import type { BotsCoreRouteDeps } from "./bots-core-deps.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createBotsCoreProfileRoutes(deps: BotsCoreRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const {
      store,
      wireBot,
      storedAvatarExists,
      botEditsNeedOwner,
      memberOwnsBot,
      viewerBotLevel,
      lockedLookRefusal,
      ownerSettingsForbidden,
      recordPersonaSave,
      broadcast,
    } = deps;
    let m: RegExpMatchArray | null = null;

    m = path.match(/^\/api\/bots\/([\w-]+)\/profile$/);
    if (m && method === "PATCH") {
      const target = store.bot(m[1]);
      if (target && botEditsNeedOwner(auth) && !memberOwnsBot(auth, target) && !atLeast(viewerBotLevel(auth, target), "edit")) {
        return json(res, 403, { error: "forbidden: only the bot owner can change its profile", code: "bot_profile_owner_only" });
      }
      const parsed = parseBotProfilePatch(await readBody(req), true);
      if (!parsed.ok) return json(res, 400, { error: parsed.error });
      if (parsed.patch.avatarUrl && !storedAvatarExists(parsed.patch.avatarUrl)) {
        return json(res, 400, { error: "avatarUrl must reference an existing stored image" });
      }
      const existingBot = store.bot(m[1]);
      const lookLocked = lockedLookRefusal(auth, existingBot, parsed.patch.mascotLook);
      if (lookLocked) return json(res, 403, lookLocked);
      // On a Cloud home a bot's name, title, description and standing
      if (parsed.patch.notifications !== undefined) {
        const refusal = ownerSettingsForbidden(auth, existingBot, { notifications: true });
        if (refusal) return json(res, 403, refusal);
      }
      const beforeProfile = existingBot ? profileSnapshot(existingBot) : undefined;
      const bot = store.patchBotProfile(m[1], parsed.patch);
      if (!bot) return json(res, 404, { error: "no such bot" });
      if (beforeProfile) recordProfileChange(bot.id, "user", "api", beforeProfile, profileSnapshot(bot));
      recordPersonaSave(auth, bot.id, beforeProfile, profileSnapshot(bot));
      const visible = wireBot(bot);
      broadcast({ kind: "bot", bot: visible });
      return json(res, 200, { bot: visible });
    }
    return PASS;
  };
}
