/**
 * Soul, system-prompt and overview (#1388 B1).
 * Own match scratch. Literal soul subpaths are matched on their own, not by /soul.
 * Never imports server/index.ts.
 */
import { soulFile, readSoulDrift, writeSoulMirror } from "../bots/bot-folder.ts";
import { parseBotProfilePatch } from "../bots/bot-profile.ts";
import { profileRevision, profileSnapshot } from "../profiles/profile-revision.ts";
import { recordProfileChange } from "../profiles/profile-versions.ts";
import { sessionPrincipal } from "../auth/request-auth.ts";

import { BOT_PROFILE_LIMITS } from "../../shared/bot-profile.ts";

import type { BotsCoreRouteDeps } from "./bots-core-deps.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createBotsCoreSoulRoutes(deps: BotsCoreRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const {
      store,
      wireBot,
      recordPersonaSave,
      broadcast,
      ownerOrAdminOf,
      computerOwner,
      previewSystemPrompt,
      botOverview,
    } = deps;
    let m: RegExpMatchArray | null = null;

    m = path.match(/^\/api\/bots\/([\w-]+)\/soul$/);
    if (m && method === "GET") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      if (!ownerOrAdminOf(auth, bot)) return json(res, 403, { error: "forbidden: only the bot owner or an admin can read its instructions here", code: "bot_instructions_owner_only" });
      const soul = bot.soul ?? "";
      const drift = readSoulDrift(bot.id, soul, bot.soulHash ?? "");
      return json(res, 200, {
        soul,
        revision: profileRevision(bot),
        bytes: Buffer.byteLength(soul, "utf8"),
        limit: BOT_PROFILE_LIMITS.soul,
        file: soulFile(bot.id),
        drift: drift.drift,
        ...(drift.drift ? { fileText: drift.fileText } : {}),
      });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/soul\/apply-file$/);
    if (m && method === "POST") {
      const body = await readBody(req);
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      if (body?.expectedRevision !== profileRevision(bot)) {
        return json(res, 409, { error: "This bot's profile changed; reload and look again" });
      }
      const drift = readSoulDrift(bot.id, bot.soul ?? "", bot.soulHash ?? "");
      if (!drift.drift) return json(res, 409, { error: "SOUL.md matches the record; nothing to apply" });
      if (typeof body?.fileText !== "string" || body.fileText !== drift.fileText) {
        return json(res, 409, { error: "SOUL.md changed since you read it; reload and look again" });
      }
      // The file is user input like any other: same cap, same error copy.
      const parsed = parseBotProfilePatch({ soul: drift.fileText });
      if (!parsed.ok) return json(res, 400, { error: parsed.error });
      // store.bot() returns the live record and setSoul mutates it in place,
      // so the snapshot must be taken before the call — after, `bot` and
      // `updated` are the same object and the diff would always be empty.
      const beforeProfile = profileSnapshot(bot);
      const updated = store.setSoul(bot.id, parsed.patch.soul ?? "");
      if (!updated) return json(res, 404, { error: "no such bot" });
      recordProfileChange(bot.id, "file", "ui", beforeProfile, profileSnapshot(updated));
      recordPersonaSave(auth, bot.id, beforeProfile, profileSnapshot(updated));
      const visible = wireBot(updated);
      broadcast({ kind: "bot", bot: visible });
      return json(res, 200, { bot: visible });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/soul\/discard-file$/);
    if (m && method === "POST") {
      const body = await readBody(req);
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      if (body?.expectedRevision !== profileRevision(bot)) {
        return json(res, 409, { error: "This bot's profile changed; reload and look again" });
      }
      const drift = readSoulDrift(bot.id, bot.soul ?? "", bot.soulHash ?? "");
      if (!drift.drift || typeof body?.fileText !== "string" || body.fileText !== drift.fileText) {
        return json(res, 409, { error: "SOUL.md changed since you read it; reload and look again" });
      }
      writeSoulMirror(bot.id, bot.soul ?? "");
      const updated = store.patchBot(bot.id, { soulDrift: false }) ?? bot;
      const visible = wireBot(updated);
      broadcast({ kind: "bot", bot: visible });
      return json(res, 200, { bot: visible });
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/system-prompt$/);
    if (m && method === "GET") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      // A client session (iOS parity) previews the prompt of a bot it owns.
      if (!ownerOrAdminOf(auth, bot) && !computerOwner(auth)) {
        return json(res, 403, { error: "forbidden: only the bot owner or an admin can read its prompt", code: "bot_prompt_owner_only" });
      }
      return json(res, 200, previewSystemPrompt(bot, sessionPrincipal(auth) ?? undefined));
    }
    m = path.match(/^\/api\/bots\/([\w-]+)\/overview$/);
    if (m && method === "GET") {
      const bot = store.bot(m[1]);
      if (!bot) return json(res, 404, { error: "no such bot" });
      // A client session (iOS parity) reads it for a bot it owns.
      if (!ownerOrAdminOf(auth, bot) && !computerOwner(auth)) {
        return json(res, 403, { error: "forbidden: only the bot owner or an admin can read what it does", code: "bot_activity_owner_only" });
      }
      return json(res, 200, await botOverview(bot));
    }
    return PASS;
  };
}
