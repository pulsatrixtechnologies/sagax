// Which requests of the app window carry the desktop owner capability
// (DESKTOP_MUTATION_HEADER, packaged builds): the per-launch proof the local
// server takes as "the desktop app itself" (server/auth/request-auth.ts).
//
// Only the requests the app's own page makes to its server: the target is
// the server's port on 127.0.0.1, and the page that asks is the app's
// (http://127.0.0.1:<port>), read from the request itself:
// - a navigation of the window: the app loading itself;
// - a frame: the page that embeds it is the app (a page preview, a widget
//   document the app serves); a frame of another origin is not;
// - anything else (an API call, an event stream, a WebSocket, the app's own
//   picture or file preview): its Referer, else its Origin, is the app.
// A picture, a clip or a segment that message content names loads with no
// Referer (the chat draws an absolute address with referrerpolicy
// no-referrer, src/lib/content-referrer.ts) and from no frame of the app, so
// it never carries the capability, even when it points at the server's port.

function originOf(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function header(headers, name) {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key ? headers[key] : undefined;
}

/** Whether the request goes to this app's server port (http: or ws:). */
export function targetsAppServer(url, serverPort) {
  try {
    const target = new URL(url);
    return (target.protocol === "http:" || target.protocol === "ws:") &&
      target.hostname === "127.0.0.1" &&
      Number(target.port || 80) === serverPort;
  } catch {
    return false;
  }
}

/** Whether this webRequest `details` is the app's own request to its server. */
export function isAppServerRequest(details, serverPort) {
  if (!details || !Number.isInteger(serverPort) || !targetsAppServer(details.url, serverPort)) return false;
  const app = `http://127.0.0.1:${serverPort}`;
  if (details.resourceType === "mainFrame") return true;
  if (details.resourceType === "subFrame") {
    let embedder = null;
    try {
      embedder = details.frame?.parent?.url ?? null;
    } catch {
      embedder = null;
    }
    return originOf(embedder) === app;
  }
  const requester = originOf(details.referrer) ?? originOf(header(details.requestHeaders, "referer")) ?? originOf(header(details.requestHeaders, "origin"));
  return requester === app;
}
