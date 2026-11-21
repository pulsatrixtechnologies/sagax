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
//   picture or file preview): its Origin when it has one, else its Referer
//   when it has one, else the origin webRequest says issued it; all three
//   are read from the request, and the page controls none of them;
// - never a request whose chain began elsewhere (a redirect toward the port).
// The app's own page sends no Origin on a same-origin GET fetch and no
// Referer (the server serves it with referrer-policy: no-referrer,
// server/static-ui.ts), so its own GET calls (the session check at launch,
// its streams and file previews) name the app only through the issuing
// origin (M-20261120-026). A load a message content names from no frame of
// the app, an opaque origin (a sandboxed bot page) or another origin names
// nothing, so it never carries the capability, even toward the server's port.

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

/**
 * The requests whose chain began somewhere else than the app's server: a
 * hop that answered with a redirect from another address marks the request
 * id (Chromium keeps one id through its redirects), and a request so marked
 * never carries the capability, whatever Referer it arrives with (a media
 * server answering 302 toward the app's port). An id stays marked until its
 * request ends (onCompleted, onErrorOccurred: `forget`), however long it
 * runs; no size limit, so no old id is ever dropped while its request lives.
 */
export function createRedirectLedger() {
  const marked = new Set();
  return {
    /** webRequest.onBeforeRedirect: `details.url` is the hop that redirected. */
    noteRedirect(details, serverPort) {
      if (!details || details.id === undefined || targetsAppServer(details.url, serverPort)) return;
      marked.add(String(details.id));
    },
    startedElsewhere(details) {
      return Boolean(details) && details.id !== undefined && marked.has(String(details.id));
    },
    /** webRequest.onCompleted / onErrorOccurred: the request is over. */
    forget(details) {
      if (details && details.id !== undefined) marked.delete(String(details.id));
    },
    get size() {
      return marked.size;
    },
  };
}

/**
 * A session takes one onCompleted and one onErrorOccurred listener: this hub
 * is that listener for the default session, and every rule that needs the
 * end of a request subscribes to it (the redirect ledger, the sign-in redeem
 * watch) instead of replacing the other's listener.
 */
export function createRequestEndHub() {
  const listeners = new Set();
  return {
    /** `listener(kind, details)`, kind "completed" or "error"; returns the unsubscribe. */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch(kind, details) {
      for (const listener of listeners) {
        try {
          listener(kind, details);
        } catch {
          /* one rule failing never stops the others */
        }
      }
    },
  };
}

/** Whether this webRequest `details` is the app's own request to its server.
 * `ledger` (createRedirectLedger) refuses a request redirected from elsewhere. */
export function isAppServerRequest(details, serverPort, ledger) {
  if (!details || !Number.isInteger(serverPort) || !targetsAppServer(details.url, serverPort)) return false;
  if (ledger?.startedElsewhere(details)) return false;
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
  // An Origin, when the request has one, is the answer: `Origin: null` (a
  // sandboxed frame, a request redirected across origins) is never made up
  // for by a Referer.
  const origin = header(details.requestHeaders, "origin");
  if (origin !== undefined) return origin === app;
  const requester = originOf(details.referrer) ?? originOf(header(details.requestHeaders, "referer"));
  if (requester === app) return true;
  // The app's own page carries neither header on its own calls: Chromium
  // sends no Origin on a same-origin GET fetch, and the page is served with
  // `referrer-policy: no-referrer` (server/static-ui.ts), so there is no
  // Referer either (M-20261120-026: the session check lost the capability at
  // launch and Personal opened on the pairing screen). webRequest names the
  // origin that issued the request, which the page controls no more than the
  // ledger above: it says the page that asks is the app. Another origin, an
  // opaque one ("null", a sandboxed bot page) or no initiator at all (an
  // older Electron, a request the browser started itself) stays refused.
  return details.initiatorOrigin === app;
}
