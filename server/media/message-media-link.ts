// A chat link to a playable file (shared/bare-image-urls.ts bareMediaKind)
// plays the way every media card of the chat does: the server's verdict
// (wireVideoFromEmit) decides the source, so an HLS stream goes through the
// media proxy (playlists rewritten, every destination checked, no reliance
// on the media server's CORS) with the original address as the fallback.
//
// The client asks for it only when the person presses Play
// (POST /api/threads/<id>/messages/<id>/media), and only for an address the
// stored message really carries: the route never mints a proxy token for an
// address a message does not show.
import { bareMediaKind } from "../../shared/bare-image-urls.ts";
import type { WireVideoWidget } from "../../shared/video-widget.ts";
import { wireVideoFromEmit } from "./media-proxy.ts";

type StoredMessage = { kind?: string; text?: string };

/** Whether a message's text shows this address (as written, or as Markdown
 * hands a link destination over, percent-encoded). */
export function messageCarriesUrl(text: string, url: string): boolean {
  if (!url || !text) return false;
  if (text.includes(url)) return true;
  try {
    const decoded = decodeURI(url);
    return decoded !== url && text.includes(decoded);
  } catch {
    return false;
  }
}

export type MessageMediaAnswer =
  | { ok: true; video: WireVideoWidget }
  | { ok: false; status: 400 | 403; error: string };

/** The playable source of one media link of one stored message. */
export function messageMediaSource(
  message: StoredMessage,
  url: unknown,
  threadId: string,
  now = Date.now(),
): MessageMediaAnswer {
  if (typeof url !== "string" || url.length > 4096) return { ok: false, status: 400, error: "url is required" };
  const kind = bareMediaKind(url);
  if (!kind) return { ok: false, status: 400, error: "not a playable media link" };
  if (message.kind !== "text" || !messageCarriesUrl(message.text ?? "", url)) {
    return { ok: false, status: 403, error: "that message does not link to this media" };
  }
  const video = wireVideoFromEmit({ kind: "vod", url, ...(kind === "hls" ? { format: "hls" as const } : {}) }, threadId, now);
  return { ok: true, video };
}
