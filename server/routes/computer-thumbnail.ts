// The bot panel's Computer row thumbnail (server/computer/computer-thumbnails.ts).
//
//   GET /api/bots/:id/computer/thumbnail?computer=<c>[&size=full][&format=json]
//     The newest capture of computer <c> (local, vm, cloud, local:<desktop
//     id>..., or auto for the newest of any): THUMBNAIL_WIDTH wide, or the
//     frame as taken with size=full (the larger preview). x-captured-at
//     carries its time. 404 when there is none yet. format=json answers its
//     time instead ({ computer, at, mime }, at null when there is none), which
//     the panel reads to version the picture's URL and to grey a stale one.
//   PUT /api/bots/:id/computer/thumbnail?computer=local[:<id>] { image }
//     The person's desktop app sends a capture of its own computer (a data
//     URL). It is kept for that person only.
//
// The gate in index.ts already hides a bot the viewer cannot see; the bot's
// own computer captures (the screen poller) reach only who may see that
// computer (`mayViewShared`: its owner, an admin, or a solo server).
import type { RequestAuth } from "../auth/request-auth.ts";
import { ComputerThumbnails, THUMBNAIL_COMPUTER, decodeImageDataUrl } from "../computer/computer-thumbnails.ts";
import { PASS, type RouteHandler } from "./table.ts";

/** A capture sent by the desktop app: a low resolution frame fits well under it. */
export const THUMBNAIL_UPLOAD_MAX_BYTES = 2_000_000;

export interface ComputerThumbnailRouteDeps<B> {
  thumbnails: ComputerThumbnails;
  bot: (id: string) => B | undefined;
  /** The person asking on an organization server; "" on a solo server. */
  viewerId: (auth: RequestAuth) => string;
  /** May this viewer see the bot's own computer captures. */
  mayViewShared: (auth: RequestAuth, bot: B) => boolean;
}

const ROUTE = /^\/api\/bots\/([\w-]+)\/computer\/thumbnail$/;

export function createComputerThumbnailRoutes<B>(deps: ComputerThumbnailRouteDeps<B>): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const m = ROUTE.exec(path);
    if (!m || (method !== "GET" && method !== "PUT")) return PASS;
    const botId = m[1]!;
    const bot = deps.bot(botId);
    if (!bot) return json(res, 404, { error: "no such bot" });
    const computer = (url.searchParams.get("computer") ?? "auto").trim();
    if (computer !== "auto" && !THUMBNAIL_COMPUTER.test(computer)) return json(res, 400, { error: "computer must be local, vm, cloud or auto" });
    const viewer = deps.viewerId(auth);

    if (method === "PUT") {
      if (!computer.startsWith("local")) return json(res, 400, { error: "only the person's own computer sends its thumbnail" });
      let body: { image?: unknown } | null;
      try {
        body = await readBody(req, THUMBNAIL_UPLOAD_MAX_BYTES * 2);
      } catch (error) {
        const status = (error as { status?: number }).status ?? 400;
        return json(res, status, { error: status === 413 ? "capture too large" : "unreadable body" });
      }
      const image = decodeImageDataUrl(body?.image);
      if (!image) return json(res, 400, { error: "image must be a PNG, JPEG or WebP data URL" });
      if (image.bytes.length > THUMBNAIL_UPLOAD_MAX_BYTES) return json(res, 413, { error: "capture too large" });
      const saved = await deps.thumbnails.record(botId, computer, image, viewer);
      if (!saved) return json(res, 400, { error: "capture not kept" });
      return json(res, 200, { computer, at: saved.at, mime: saved.thumbMime });
    }

    const item = deps.thumbnails.get(botId, computer, viewer, deps.mayViewShared(auth, bot));
    res.setHeader("cache-control", "private, no-store");
    if (url.searchParams.get("format") === "json") {
      return json(res, 200, item ? { computer: item.computer, at: item.at, mime: item.thumbMime } : { computer, at: null, mime: null });
    }
    if (!item) return json(res, 404, { error: "no capture of this computer yet", code: "no_thumbnail" });
    const full = url.searchParams.get("size") === "full";
    const bytes = full ? item.full : item.thumb;
    res.writeHead(200, {
      "content-type": full ? item.mime : item.thumbMime,
      "content-length": String(bytes.length),
      "cache-control": "private, no-store",
      "x-captured-at": String(item.at),
      "x-thumbnail-computer": item.computer,
    });
    res.end(bytes);
  };
}
