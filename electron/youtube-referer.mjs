// The Referer of the YouTube player in the chat (YouTubeMiniPlayer, #761).
//
// YouTube's embedded player refuses a page it cannot identify: no Referer on
// the embed document gives "Video player configuration error, Error 153",
// and a Referer whose host is an IP address (http://127.0.0.1:<port>/, the
// local window's origin) gives "This video is unavailable". Both reached the
// desktop app:
// - Organization server: the page's own origin is taken over by
//   electron/bundled-ui.cjs, which answers every https request, and the
//   requests of other origins it passes on with net.fetch leave without the
//   Referer Chromium computed. The embed document went out with none.
// - Local window: http://127.0.0.1:<port>, an IP address.
//
// So, for the YouTube embed document only (an /embed/ page of youtube.com or
// youtube-nocookie.com), the Referer is the embedding page's origin, as the
// default policy (strict-origin-when-cross-origin) sends it, with a loopback
// address named localhost: the same page under its other name. Nothing else
// gets a Referer it did not already have, and no path or query ever leaves.
// Trade-off, chosen: a frame that asked for no-referrer (a bot-made widget
// embedding YouTube) still sends the app's origin to YouTube, origin only,
// since without it the player cannot play at all.
// Pure, so node:test covers every rule.

const EMBED_HOSTS = new Set([
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
  "www.youtube.com",
  "youtube.com",
  "m.youtube.com",
]);

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]"]);

/** True for YouTube's embedded player document. */
export function isYoutubeEmbedUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.protocol === "https:" && EMBED_HOSTS.has(url.hostname) && url.pathname.startsWith("/embed/");
}

/** The origin YouTube accepts for a page, with a trailing slash, or null
 * (not http or https: a file, a data URL, about:blank). A loopback address
 * is named localhost. Never a path or a query. */
export function embedderReferer(raw) {
  if (typeof raw !== "string" || !raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (LOOPBACK_HOSTS.has(url.hostname)) url.hostname = "localhost";
  return `${url.origin}/`;
}

function headerName(headers, wanted) {
  return Object.keys(headers).find((name) => name.toLowerCase() === wanted);
}

/**
 * The request headers for one request: the same object when there is nothing
 * to change, else a copy with the Referer set.
 * @param {{ url: string, requestHeaders: Record<string, string>, referrer?: string }} details
 * @param {() => string | null | undefined} pageUrl  the embedding page when the
 *   request carries no referrer (a request passed on by bundled-ui.cjs)
 */
export function withYoutubeEmbedReferer(details, pageUrl) {
  const headers = details.requestHeaders ?? {};
  if (!isYoutubeEmbedUrl(details.url)) return headers;
  const name = headerName(headers, "referer");
  const current = name ? headers[name] : "";
  const source = current || details.referrer || pageUrl?.() || "";
  const referer = embedderReferer(source);
  if (!referer || referer === current) return headers;
  const next = { ...headers };
  if (name) delete next[name];
  next.Referer = referer;
  return next;
}
