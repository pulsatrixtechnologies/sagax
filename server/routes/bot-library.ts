// The bot profile's Links, Media and Files tabs, and Share as Template
// (iOS parity, screens 03 and 08 to 10).
//
//   GET  /api/bots/:id/links?cursor=&limit=
//        { links: [{ url, domain, title?, messageId, threadId, at }], nextCursor, total }
//   GET  /api/bots/:id/files?kind=media|file&cursor=&limit=
//        { files: [{ id, threadId, messageId, name, mime?, size, available, source, at,
//                    kind, url, previewUrl? }], nextCursor, total }
//   POST /api/bots/:id/export
//        { document, filename, redacted, skipped, summary }: one bot as a team
//        package (format v2), without its chats or any secret; owner or admin.
//
// When the bot is shared, Links / Media / Files cover the bot's whole library
// (threads of the owner and of every person in the share), confidential
// threads excluded (#2019). A person without a share still sees nothing of
// anyone else's. The file and preview URLs are the existing per-thread file
// routes (authorized for a shared viewer on those non-confidential threads
// only), so no host path ever travels. Member scope (request-auth.ts
// CLIENT_ALLOW); the export stays owner or admin.
import { collectBotLinks, mergeBotFiles, pageOf, readPageQuery, type BotFileKind, type LinkSourceMessage } from "../bots/bot-library.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import type { ThreadFile } from "../threads/thread-files.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface BotLibraryBot {
  id: string;
}

export interface BotLibraryRouteDeps<B extends BotLibraryBot> {
  bot: (id: string) => B | undefined;
  /** The bot threads this request may read, newest last or in any order. */
  threadsFor: (bot: B, auth: RequestAuth) => string[];
  /** The visible branch of one thread. */
  messages: (threadId: string) => readonly LinkSourceMessage[];
  files: (threadId: string) => Promise<readonly ThreadFile[]>;
  /** The bot's owner or an admin (or the owner at this computer). */
  mayExport: (auth: RequestAuth, bot: B) => boolean;
  /** Throws an error carrying `status` for a refusal the person can act on. */
  exportBot: (bot: B) => unknown;
}

const ROUTE = /^\/api\/bots\/([\w-]+)\/(links|files|export)$/;

export function createBotLibraryRoutes<B extends BotLibraryBot>(deps: BotLibraryRouteDeps<B>): RouteHandler {
  return async ({ res, url, path, method, auth, json }) => {
    const m = ROUTE.exec(path);
    if (!m) return PASS;
    const [, botId, action] = m;
    const expected = action === "export" ? "POST" : "GET";
    if (method !== expected) return json(res, 405, { error: `${expected} only` });
    const bot = deps.bot(botId!);
    if (!bot) return json(res, 404, { error: "no such bot" });
    res.setHeader("cache-control", "private, no-store");

    if (action === "export") {
      if (!deps.mayExport(auth, bot)) return json(res, 403, { error: "forbidden: only the bot owner or an admin can share it as a template", code: "bot_share_owner_only" });
      try {
        return json(res, 200, deps.exportBot(bot));
      } catch (error) {
        const status = (error as { status?: unknown })?.status;
        if (typeof status === "number" && status >= 400 && status < 500) {
          return json(res, status, { error: error instanceof Error ? error.message : "This bot could not be shared." });
        }
        throw error;
      }
    }

    const page = readPageQuery(url.searchParams);
    if (!page.ok) return json(res, 400, { error: page.error });
    const threads = [...new Set(deps.threadsFor(bot, auth))];

    if (action === "links") {
      const links = collectBotLinks(threads.map((threadId) => ({ threadId, messages: deps.messages(threadId) })));
      const { items, nextCursor, total } = pageOf(links, page.offset, page.limit);
      return json(res, 200, { links: items, nextCursor, total });
    }

    const kindRaw = url.searchParams.get("kind");
    if (kindRaw !== null && kindRaw !== "media" && kindRaw !== "file") return json(res, 400, { error: "kind must be media or file" });
    const kind = (kindRaw ?? undefined) as BotFileKind | undefined;
    const listings = await Promise.all(threads.map(async (threadId) => ({ threadId, files: await deps.files(threadId).catch(() => []) })));
    const { items, nextCursor, total } = pageOf(mergeBotFiles(listings, kind), page.offset, page.limit);
    return json(res, 200, { files: items, nextCursor, total });
  };
}
