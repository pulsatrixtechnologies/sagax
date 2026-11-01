import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

import { streamProxiedMedia, verifyMediaProxyToken } from "../media-proxy.ts";
import { logMediaProxyRefusal, MediaProxyBlockedError } from "../media-proxy-guard.ts";
import { fetchYoutubeTranscript } from "../youtube-transcript.ts";
import { PASS, type RouteHandler } from "./table.ts";

const transcriptBody = z.object({ videoId: z.string().regex(/^[\w-]{11}$/) }).strict();

/**
 * GET /api/media/proxy/<token>, answered before the auth gate (server/index.ts).
 *
 * The signed token in the path is the authorization: native players
 * (AVPlayer on iOS, a <video> element, a cast receiver) cannot add the
 * session's bearer header to the playlist and segment requests they make.
 * The token is an HMAC-SHA256 (192 bits kept) over the exact upstream URL,
 * its expiry (4 h) and the thread it was minted for, with a key that never
 * leaves the server; a token without a thread is refused here. It opens this
 * one read-only route and nothing else: resolveRequestAuth never treats it as
 * a session credential. Neither the token nor the upstream URL is logged.
 *
 * The upstream URL came from a bot: server/media-proxy-guard.ts refuses
 * loopback, private, link-local, metadata and other non-public destinations
 * (after DNS, on every redirect) unless SAGAX_MEDIA_PROXY_ALLOW_HOSTS allows
 * them, with a generic 403 here and the reason in one server log line.
 *
 * Returns false when the request is not for this route.
 */
export async function handleMediaProxy(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
  now = Date.now(),
): Promise<boolean> {
  if (!(path.startsWith("/api/media/proxy/") && method === "GET")) return false;
  const refuse = (status: number, error: string) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ error }));
  };
  // Proxied bytes are media, never a page of this origin, and the token in
  // this URL must not travel in a Referer.
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("content-security-policy", "sandbox; default-src 'none'");
  let token: string;
  try {
    token = decodeURIComponent(path.slice("/api/media/proxy/".length));
  } catch {
    refuse(403, "Invalid or expired media link");
    return true;
  }
  const body = verifyMediaProxyToken(token, now);
  if (!body || typeof body.t !== "string" || !body.t) {
    refuse(403, "Invalid or expired media link");
    return true;
  }
  const range = req.headers.range;
  try {
    await streamProxiedMedia(body.u, res, typeof range === "string" ? range : undefined, { threadId: body.t, now });
  } catch (error) {
    if (error instanceof MediaProxyBlockedError) {
      // The reason goes to the server log (reason and host only); the client
      // gets one generic answer whatever the destination was.
      logMediaProxyRefusal(error);
      if (!res.headersSent) refuse(403, "Media source not allowed");
      else if (!res.writableEnded) res.end();
      return true;
    }
    if (!res.headersSent) refuse(502, "Could not reach the media source");
    // Once media headers were sent, a JSON error cannot be truthful. Break
    // the response so players see a failed/truncated transfer, never a clean
    // 200 with incomplete bytes.
    else if (!res.writableEnded) res.destroy();
  }
  return true;
}

export function createMediaWidgetRoutes(): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path === "/api/youtube/transcript" && method === "POST") {
      // A person: a signed-in session, the desktop app (loopback owner) or a
      // phone through the companion (loopback too). Not a bot's shell on a
      // shared server (loopback service trust).
      if (auth.kind === "loopback" ? auth.trust === "service" : auth.kind !== "session") return json(res, 401, { error: "Unauthorized" });
      const parsed = transcriptBody.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "invalid_video", message: "Identifiant de vidéo YouTube invalide." });
      try {
        const transcript = await fetchYoutubeTranscript(parsed.data.videoId);
        return json(res, 200, { videoId: parsed.data.videoId, ...transcript });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "no_captions") return json(res, 404, { error: "no_captions", message: "Cette vidéo n'a pas de sous-titres publics." });
        if (code === "invalid_video") return json(res, 400, { error: "invalid_video", message: "Identifiant de vidéo YouTube invalide." });
        if (code === "unavailable") return json(res, 422, { error: "unavailable", message: "Vidéo privée, retirée ou restreinte : YouTube n'en donne pas la transcription." });
        return json(res, 502, { error: "blocked", message: "YouTube n'a pas rendu la transcription pour l'instant. Réessaie plus tard." });
      }
    }
    return PASS;
  };
}
