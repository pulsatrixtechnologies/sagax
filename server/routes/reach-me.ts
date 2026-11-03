// "Me joindre" on the bot page (2026-10-26):
//
//   GET    /api/bots/:id/reach-me           the person's choice for this bot
//                                            (or the default: push, any hour)
//                                            and each channel's readiness
//   PUT    /api/bots/:id/reach-me           { channels, smsNumber?, hours }
//   POST   /api/bots/:id/reach-me/telegram  { token }  the person's own bot from
//                                            BotFather: checked, sealed, and a
//                                            t.me link to press Start in
//   DELETE /api/bots/:id/reach-me/telegram  forget that bot and chat
//   POST   /api/bots/:id/reach-me/whatsapp  { accessToken, phoneNumberId,
//                                            appSecret?, templateName?,
//                                            templateLanguage?, businessAccountId? }
//                                            the person's
//                                            own WhatsApp Business number:
//                                            checked with Meta, sealed, and a
//                                            code to prove their own number
//   PUT    /api/bots/:id/reach-me/whatsapp  { templateName?, templateLanguage?,
//                                            appSecret?, businessAccountId? } without
//                                            the token again; a template set is
//                                            checked with Meta again (also {} alone)
//   DELETE /api/bots/:id/reach-me/whatsapp  forget the token, app secret, number
//   POST   /api/bots/:id/reach-me/whatsapp/link  {} a fresh wa.me code;
//                                            { number } the code by template to
//                                            that number; { code } the code typed
//                                            back from it
//
// Each person chooses for themself, for each bot they can see: no admin,
// no owner check (the setting only says how THIS person is reached about
// the cards that wait on them). Client-scoped in server/auth/request-auth.ts;
// the bot visibility check every client route passes answers a hidden bot
// as missing first. Tokens and the app secret are write only: never in an
// answer.
import { parseReachMe, type ReachChannelId } from "../../shared/reach-me.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import type { ReachMeStore } from "../reach-me/store.ts";
import type { ReachTelegram } from "../reach-me/telegram.ts";
import type { ReachWhatsApp, WhatsAppView } from "../reach-me/whatsapp.ts";
import { PASS, type RouteHandler } from "./table.ts";

export type ReachChannelView = { ready: boolean; reason?: string; devices?: number; connected?: boolean; username?: string; linking?: boolean } & Partial<Omit<WhatsAppView, "connected" | "linking">>;

export interface ReachMeRouteDeps {
  person(auth: RequestAuth): string | undefined;
  bot(id: string): { id: string } | null | undefined;
  settings: ReachMeStore;
  channelStatus(person: string, botId: string): Record<ReachChannelId, ReachChannelView>;
  telegram: Pick<ReachTelegram, "connect" | "disconnect">;
  whatsapp: Pick<ReachWhatsApp, "connect" | "update" | "disconnect" | "renewLink" | "sendCode" | "confirm">;
}

const text = (value: unknown) => typeof value === "string" ? value : undefined;

export function createReachMeRoutes(deps: ReachMeRouteDeps): RouteHandler {
  const view = (person: string, botId: string) => {
    const saved = deps.settings.get(person, botId);
    return { saved: saved !== null, settings: saved ?? deps.settings.effective(person, botId), channels: deps.channelStatus(person, botId) };
  };
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const m = /^\/api\/bots\/([\w-]+)\/reach-me(\/telegram|\/whatsapp|\/whatsapp\/link)?$/.exec(path);
    if (!m) return PASS;
    const bot = deps.bot(m[1]!);
    if (!bot) return json(res, 404, { error: "no such bot" });
    res.setHeader("cache-control", "no-store");
    const person = deps.person(auth);
    if (!person) return json(res, 403, { error: "Only a signed-in person chooses how a bot reaches them.", code: "session_required" });
    if (m[2] === "/whatsapp/link") {
      if (method !== "POST") return json(res, 405, { error: "POST" });
      const body = await readBody(req) as Record<string, unknown> | null;
      const result = typeof body?.code === "string" ? deps.whatsapp.confirm(person, bot.id, body.code)
        : typeof body?.number === "string" ? await deps.whatsapp.sendCode(person, bot.id, body.number)
          : deps.whatsapp.renewLink(person, bot.id);
      if (!result.ok) return json(res, result.status, { error: result.error });
      return json(res, 200, { ok: true, ...view(person, bot.id) });
    }
    if (m[2] === "/whatsapp") {
      if (method === "POST") {
        const body = await readBody(req) as Record<string, unknown> | null;
        const accessToken = text(body?.accessToken)?.trim() ?? "";
        const phoneNumberId = text(body?.phoneNumberId)?.trim() ?? "";
        if (!accessToken || !phoneNumberId) return json(res, 400, { error: "Paste your access token and your number's Phone Number ID from your Meta app (WhatsApp > API Setup)." });
        const result = await deps.whatsapp.connect(person, bot.id, {
          accessToken, phoneNumberId,
          ...(text(body?.appSecret) ? { appSecret: text(body?.appSecret)! } : {}),
          ...(text(body?.templateName) ? { templateName: text(body?.templateName)! } : {}),
          ...(text(body?.templateLanguage) ? { templateLanguage: text(body?.templateLanguage)! } : {}),
          ...(text(body?.businessAccountId) ? { businessAccountId: text(body?.businessAccountId)! } : {}),
        });
        if (!result.ok) return json(res, result.status, { error: result.error });
        return json(res, 200, { ok: true, ...view(person, bot.id) });
      }
      if (method === "PUT") {
        const body = await readBody(req) as Record<string, unknown> | null;
        const result = await deps.whatsapp.update(person, bot.id, {
          ...(text(body?.templateName) !== undefined ? { templateName: text(body?.templateName)! } : {}),
          ...(text(body?.templateLanguage) !== undefined ? { templateLanguage: text(body?.templateLanguage)! } : {}),
          ...(text(body?.appSecret) !== undefined ? { appSecret: text(body?.appSecret)! } : {}),
          ...(text(body?.businessAccountId) !== undefined ? { businessAccountId: text(body?.businessAccountId)! } : {}),
        });
        if (!result.ok) return json(res, result.status, { error: result.error });
        return json(res, 200, { ok: true, ...view(person, bot.id) });
      }
      if (method === "DELETE") {
        deps.whatsapp.disconnect(person, bot.id);
        return json(res, 200, { ok: true, ...view(person, bot.id) });
      }
      return json(res, 405, { error: "POST, PUT or DELETE" });
    }
    if (m[2]) {
      if (method === "POST") {
        const body = await readBody(req) as { token?: unknown } | null;
        const token = typeof body?.token === "string" ? body.token : "";
        if (!token.trim()) return json(res, 400, { error: "Paste your bot's token from BotFather." });
        const result = await deps.telegram.connect(person, bot.id, token);
        if (!result.ok) return json(res, result.status, { error: result.error });
        return json(res, 200, { ok: true, username: result.username, link: result.link, ...view(person, bot.id) });
      }
      if (method === "DELETE") {
        deps.telegram.disconnect(person, bot.id);
        return json(res, 200, { ok: true, ...view(person, bot.id) });
      }
      return json(res, 405, { error: "POST or DELETE" });
    }
    if (method === "GET") return json(res, 200, view(person, bot.id));
    if (method === "PUT") {
      const parsed = parseReachMe(await readBody(req));
      if (!parsed.ok) return json(res, 400, { error: parsed.error, field: parsed.field });
      deps.settings.set(person, bot.id, parsed.settings);
      return json(res, 200, view(person, bot.id));
    }
    return json(res, 405, { error: "GET or PUT" });
  };
}
