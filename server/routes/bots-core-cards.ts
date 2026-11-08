/**
 * PATCH onboarding cards and POST active-branch (#1388 B1).
 * Own match scratch. Never imports server/index.ts.
 */
import { cloudThreadRefusal } from "../cloud-thread-refusal.ts";

import type { BotsCoreRouteDeps } from "./bots-core-deps.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createBotsCoreCardsRoutes(deps: BotsCoreRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const {
      store,
      requestedTaskBot,
      requirePinnedClientThread,
      threadBusy,
      phoneSecretSubmissions,
    } = deps;
    let m: RegExpMatchArray | null = null;

    // onboarding/ask cards persist their answered/dismissed state
    m = path.match(/^\/api\/bots\/([\w-]+)\/cards\/([\w-]+)$/);
    if (m && method === "PATCH") {
      const body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return json(res, 400, { error: "body must be a JSON object" });
      }
      const bot = requestedTaskBot(m[1], body.threadId);
      const existing = store.messagesFor(bot.threadId).find((msg) => msg.id === m![2]);
      if (!existing?.card) return json(res, 404, { error: "no such card" });
      if (existing.card.requestId) {
        return json(res, 409, { error: "request cards must be answered through the approval endpoint" });
      }
      if (Object.keys(body).some((key) => key !== "answered" && key !== "dismissed" && key !== "threadId")) {
        return json(res, 400, { error: "only answered and dismissed may be changed" });
      }
      if (body.answered !== undefined && typeof body.answered !== "string") {
        return json(res, 400, { error: "answered must be a string" });
      }
      if (body.dismissed !== undefined && typeof body.dismissed !== "boolean") {
        return json(res, 400, { error: "dismissed must be true or false" });
      }
      const patched = store.patchMessage(bot.threadId, m[2], {
        card: {
          ...existing.card,
          ...(body.answered !== undefined ? { answered: body.answered } : {}),
          ...(body.dismissed !== undefined ? { dismissed: body.dismissed } : {}),
        },
      });
      return json(res, 200, { message: patched });
    }

    // a terminal card folds to one row and opens again; the choice stays on
    // the message, so a reload shows the card the way it was left
    m = path.match(/^\/api\/bots\/([\w-]+)\/terminal-embeds\/([\w-]+)$/);
    if (m && method === "PATCH") {
      const body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return json(res, 400, { error: "body must be a JSON object" });
      }
      if (Object.keys(body).some((key) => key !== "collapsed" && key !== "threadId")) {
        return json(res, 400, { error: "only collapsed may be changed" });
      }
      if (typeof body.collapsed !== "boolean") return json(res, 400, { error: "collapsed must be true or false" });
      const bot = requestedTaskBot(m[1], body.threadId);
      const notYours = cloudThreadRefusal(auth, bot.threadId);
      if (notYours) return json(res, 403, { error: notYours });
      const existing = store.messagesFor(bot.threadId).find((msg) => msg.id === m![2]);
      if (!existing?.terminalEmbed) return json(res, 404, { error: "no such terminal" });
      const patched = store.patchMessage(bot.threadId, m[2], {
        terminalEmbed: { ...existing.terminalEmbed, collapsed: body.collapsed },
      });
      return json(res, 200, { message: patched });
    }

    m = path.match(/^\/api\/bots\/([\w-]+)\/active-branch$/);
    if (m && method === "POST") {
      const body = await readBody(req);
      requirePinnedClientThread(auth, req, m[1], body?.threadId);
      const bot = requestedTaskBot(m[1], body.threadId);
      const notYours = cloudThreadRefusal(auth, bot.threadId);
      if (notYours) return json(res, 403, { error: notYours });
      if (threadBusy(bot.id, bot.threadId)) return json(res, 409, { error: "the thread is working — stop it before switching versions" });
      if (phoneSecretSubmissions.hasThread(bot.threadId)) {
        return json(res, 409, { error: "this task is securely saving a credential — try again when it finishes" });
      }
      const leaf = store.setActiveLeaf(bot.threadId, String(body.messageId ?? ""));
      if (!leaf) return json(res, 404, { error: "no such message" });
      // provider sessions still hold the other branch — next turn replays
      store.patchTask(bot.id, bot.threadId, { rewound: true });
      return json(res, 200, { activeLeafId: leaf });
    }
    return PASS;
  };
}
