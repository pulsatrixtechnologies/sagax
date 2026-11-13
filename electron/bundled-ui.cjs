// The desktop's own UI on an organization server's origin.
//
// A remote environment used to load the server's own served page, built from
// whatever image is deployed there: another version of the UI than the app
// the person installed, and without the desktop-only parts. For an
// organization server (environments.cjs `org: true`), the main window still
// navigates to the server's origin, but every page request (the document,
// scripts, styles, images, fonts) is answered from THIS app's bundle, while
// the server keeps everything that is the server's: /api/*, /.well-known/*
// and /auth/* (the OIDC start and callback). The page therefore stays
// same-origin with its API: the session cookie (HttpOnly, SameSite) rides as
// before, no CORS, no token in the renderer, and the server's authorization
// is unchanged. Only the code that draws the page comes from the desktop.
//
// Electron routes a scheme to one handler (protocol.handle), so requests to
// any other origin are passed through untouched, with
// bypassCustomProtocolHandlers. Each saved organization server keeps its page
// open (electron/page-contexts.mjs), so the handler serves all of them, each
// on its own origin. Pure apart from the injected fetch and file
// reader, so node:test covers every rule.
const path = require("node:path");

/** Paths the server answers itself; everything else is the UI. /pages/ is
 * the published pages (server/routes/published-pages.ts): a page's wrapper,
 * its sandboxed frame, its reader comments. Answered from the bundle, a
 * page's address was the app's index.html, so a page's card and the open
 * page drew Sagax itself instead of the page (0.8.11). */
const SERVER_PREFIXES = ["/api/", "/.well-known/", "/auth/", "/pages/"];

/** A published page's documents (GET/HEAD under /pages/): framed by the app
 * (a card, the open page) with no referrer, so fromBundledPage cannot see
 * them. They carry the session like any same-site frame would: the server
 * serves a preview to its own person only, frames it under its CSP
 * (frame-ancestors 'self', sandbox, no network) and answers 404 otherwise. */
function pageDocument(request) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  try {
    return new URL(request.url).pathname.startsWith("/pages/");
  } catch {
    return false;
  }
}

/** A published page's frame itself (the page, under its sandbox CSP). */
const PAGE_FRAME_PREFIXES = ["/pages/frame/", "/pages/preview-frame/"];

/** Whether a URL is a published page's frame (/pages/frame/...,
 * /pages/preview-frame/...). Pure. */
function isPageFrameUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    return PAGE_FRAME_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  } catch {
    return false;
  }
}

/**
 * The page frames a window of this app is loading as an iframe right now.
 *
 * The server answers a page frame only to a browser that says it loads it as
 * an iframe (Sec-Fetch-Dest: iframe), never as a top-level document. Passed
 * through net.fetch, every request says "empty" instead (Chromium's own
 * fetch metadata for a browser-made fetch), and a custom protocol handler is
 * not told what the request is for. So the frame was refused with a 404
 * whose CSP (frame-ancestors 'none') blocked it: a page's card and the open
 * page drew a blank white frame (0.8.12). main.mjs notes each subframe
 * navigation to a page frame (will-frame-navigate, which knows it is a
 * subframe and runs before the request); the handler then says "iframe" for
 * that one request, exactly as the browser would have. A top-level load, a
 * fetch or anything not noted still says "empty" and is still refused.
 * Each note is used once and lapses after `ttlMs`.
 */
function createPageFrameLoads({ now = () => Date.now(), ttlMs = 30_000, max = 64 } = {}) {
  const pending = new Map();
  const key = (url) => {
    try {
      return new URL(url).href;
    } catch {
      return null;
    }
  };
  const prune = () => {
    const at = now();
    for (const [url, until] of pending) if (until <= at) pending.delete(url);
    while (pending.size > max) pending.delete(pending.keys().next().value);
  };
  return {
    /** A subframe is about to load this page frame. */
    expect(url) {
      const href = isPageFrameUrl(url) ? key(url) : null;
      if (!href) return false;
      pending.delete(href);
      pending.set(href, now() + ttlMs);
      prune();
      return true;
    },
    /** True once for a noted, unexpired frame load; the note is used up. */
    take(url) {
      const href = key(url);
      if (!href || !pending.has(href)) return false;
      const until = pending.get(href);
      pending.delete(href);
      return until > now();
    },
  };
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".glb": "model/gltf-binary",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

/** True when the server owns this path (the API, discovery, OIDC). */
function servedByServer(pathname) {
  if (typeof pathname !== "string") return true;
  return SERVER_PREFIXES.some((prefix) => pathname === prefix.slice(0, -1) || pathname.startsWith(prefix));
}

/**
 * What to do with one request.
 *   { kind: "pass" }                 another origin, or the server's own path
 *   { kind: "redirect", location }  the old invitation page: an organization
 *                                    server sends it to sign-in (server/index.ts)
 *   { kind: "bundle", pathname }     the UI, from this app's bundle
 */
function routeRequest({ url, method }, bundled) {
  let target;
  try {
    target = new URL(url);
  } catch {
    return { kind: "pass" };
  }
  if (!bundled || target.origin !== bundled) return { kind: "pass" };
  if (method !== "GET" && method !== "HEAD") return { kind: "pass" };
  if (servedByServer(target.pathname)) return { kind: "pass" };
  if (target.pathname === "/join" || target.pathname === "/join/") return { kind: "redirect", location: `${bundled}/pair` };
  return { kind: "bundle", pathname: target.pathname };
}

/** The file for a UI path inside the bundle, or null. A path with no
 * extension is a page of the single-page app: index.html. A missing asset is
 * a 404, never the app shell (a stale script must fail loudly). */
function bundleFile(staticDir, pathname) {
  if (typeof staticDir !== "string" || !staticDir) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const root = path.resolve(staticDir);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const file = path.resolve(root, relative);
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  const extension = path.extname(file).toLowerCase();
  if (!extension) return { file: path.join(root, "index.html"), type: MIME[".html"], fallback: true };
  return { file, type: MIME[extension] ?? "application/octet-stream", fallback: false };
}

/** Whether a request to the organization server was sent BY the bundled
 * page itself. Chromium hands a custom handler neither the Origin header nor
 * the real credentials mode, so the referrer is the only witness: the
 * bundled page's own requests carry its URL (the default policy keeps the
 * full same-origin URL). A sandboxed widget (srcdoc, opaque origin), a page
 * of another origin, or a request with no referrer is not the page. */
function fromBundledPage(request, bundled) {
  if (!bundled) return false;
  try {
    return new URL(request.referrer).origin === bundled && new URL(request.url).origin === bundled;
  } catch {
    return false;
  }
}

/** Headers for a pass-through to the organization server. The server checks
 * Origin on cookie writes (server/auth/request-auth.ts isSameOrigin), so a write
 * sent by the bundled page carries that origin again. Any other request gets
 * none, and no cookie either (see createBundledUiHandler). */
function passThroughHeaders(request, bundled, options = {}) {
  const headers = new Headers(request.headers);
  headers.delete("origin");
  if (request.method === "GET" || request.method === "HEAD") {
    // a page frame a window is loading as an iframe (createPageFrameLoads):
    // the fetch metadata the browser would have sent (net.fetch accepts
    // "iframe" with mode "navigate" only)
    if (options.pageFrame) {
      headers.set("sec-fetch-dest", "iframe");
      headers.set("sec-fetch-mode", "navigate");
    }
    return headers;
  }
  if (fromBundledPage(request, bundled)) headers.set("origin", bundled);
  return headers;
}

const BUNDLE_HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

/** How long an attachment read passed through to the organization server
 * may wait for its response head (#4205). Electron's protocol.handle hands
 * the handler a Request with no abort signal: when the page drops an <img>
 * (scrolled away, replaced, Retry), nothing tells the handler, and the
 * upstream net.fetch kept waiting and kept its slot in the session's
 * connection pool. A message with hundreds of pictures left that many
 * upstream requests queued or stalled, so every later picture waited behind
 * them and its tile spun for ever. Each attachment read now has its own
 * abort controller, aborted when no head came by this deadline; the page
 * then gets a 504 and the tile shows its broken state with Retry. Only the
 * wait for the head is bounded: a body that is streaming is never cut. */
const ATTACHMENT_HEAD_DEADLINE_MS = 20_000;

/** A read of an attachment (GET/HEAD under /api/attachments/). Pure. */
function attachmentRead(request) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  try {
    return new URL(request.url).pathname.startsWith("/api/attachments/");
  } catch {
    return false;
  }
}

/** deps.fetch with its own abort controller, aborted when no response head
 * came within `deadlineMs`; the caller then gets a 504. The response that
 * does come is returned untouched, so protocol.handle still relays its body
 * natively. */
async function fetchWithHeadDeadline(fetch, url, init, deadlineMs) {
  const upstream = new AbortController();
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => {
      resolve(new Response(null, { status: 504, statusText: "Gateway Timeout", headers: BUNDLE_HEADERS }));
      upstream.abort(new Error(`no response head within ${deadlineMs} ms`));
    }, deadlineMs);
  });
  try {
    return await Promise.race([fetch(url, { ...init, signal: upstream.signal }), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The bundled origin a request is for: the one of `bundled` (one origin,
 * a list of them, or null) that is the request's own origin, else null.
 * Each organization server's page keeps its own origin: a request carries
 * the cookie of the server it is sent to only when that server's own page
 * sent it (fromBundledPage), never another server's page. */
function bundledOriginFor(bundled, url) {
  const list = Array.isArray(bundled) ? bundled : bundled ? [bundled] : [];
  if (list.length === 0) return null;
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    return list.length === 1 ? list[0] : null;
  }
  return list.includes(origin) ? origin : (list.length === 1 ? list[0] : null);
}

/**
 * @param {{
 *   origin: () => string | string[] | null,   the bundled origin(s) right now: every saved organization server
 *   staticDir?: () => string | null,          the built UI (packaged: resources/ui)
 *   devOrigin?: () => string | null,          the Vite dev server when unpackaged
 *   fetch: (input: any, init?: any) => Promise<Response>,  net.fetch
 *   readFile: (file: string) => Promise<Uint8Array>,
 *   pageFrames?: { take: (url: string) => boolean },  the page frames a window loads as an iframe (createPageFrameLoads)
 *   log?: (line: string) => void,
 *   attachmentHeadDeadlineMs?: number,        how long an attachment read waits for its head (ATTACHMENT_HEAD_DEADLINE_MS)
 * }} deps
 */
function createBundledUiHandler(deps) {
  const log = deps.log ?? (() => {});
  const bypass = { bypassCustomProtocolHandlers: true };
  return async function handle(request) {
    const bundled = bundledOriginFor(deps.origin(), request.url);
    const route = routeRequest(request, bundled);
    if (route.kind === "pass") {
      if (!bundled || new URL(request.url).origin !== bundled) return deps.fetch(request, bypass);
      // The session cookie rides only with the bundled page's own requests,
      // like SameSite would keep it from a cross-site one: a bot-made widget
      // or another origin's frame reaches the API signed out. This app's
      // main process calls the server with bypassCustomProtocolHandlers and
      // never comes through here.
      const init = {
        ...bypass,
        method: request.method,
        headers: passThroughHeaders(request, bundled, {
          pageFrame: pageDocument(request) && isPageFrameUrl(request.url) && deps.pageFrames?.take(request.url) === true,
        }),
        credentials: fromBundledPage(request, bundled) || pageDocument(request) ? "include" : "omit",
        redirect: "follow",
      };
      if (request.method !== "GET" && request.method !== "HEAD" && request.body) {
        init.body = request.body;
        init.duplex = "half";
      }
      if (!attachmentRead(request)) return deps.fetch(request.url, init);
      return fetchWithHeadDeadline(deps.fetch, request.url, init, deps.attachmentHeadDeadlineMs ?? ATTACHMENT_HEAD_DEADLINE_MS);
    }
    if (route.kind === "redirect") {
      return new Response(null, { status: 302, headers: { location: route.location, "cache-control": "no-store" } });
    }
    const search = new URL(request.url).search;
    const dev = deps.devOrigin?.();
    if (dev) {
      // Development: the page comes from Vite, like the local window's.
      const upstream = await deps.fetch(`${dev}${route.pathname}${search}`, bypass);
      const headers = new Headers(BUNDLE_HEADERS);
      const type = upstream.headers.get("content-type");
      if (type) headers.set("content-type", type);
      return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers });
    }
    const target = bundleFile(deps.staticDir?.(), route.pathname);
    if (!target) return new Response("Not found", { status: 404, headers: BUNDLE_HEADERS });
    try {
      const data = await deps.readFile(target.file);
      return new Response(request.method === "HEAD" ? null : data, { status: 200, headers: { ...BUNDLE_HEADERS, "content-type": target.type } });
    } catch {
      if (!target.fallback) log(`bundled UI: no ${route.pathname} in this app's bundle`);
      return new Response("Not found", { status: 404, headers: BUNDLE_HEADERS });
    }
  };
}

/**
 * Serve the bundle and nothing else: for the floating bot and Hibou 98
 * windows when this app runs no local server (server mode). They live in
 * their own in-memory session, so they hold no cookie of any server, and
 * every request that is not a UI file is refused.
 */
const DETACHED_UI_ORIGIN = "https://ui.sagax.invalid";
function createDetachedUiHandler(deps) {
  const inner = createBundledUiHandler({ ...deps, origin: () => DETACHED_UI_ORIGIN });
  return async function handle(request) {
    const route = routeRequest(request, DETACHED_UI_ORIGIN);
    if (route.kind !== "bundle") return new Response("Not available", { status: 403, headers: BUNDLE_HEADERS });
    return inner(request);
  };
}

module.exports = {
  ATTACHMENT_HEAD_DEADLINE_MS,
  DETACHED_UI_ORIGIN,
  bundledOriginFor,
  bundleFile,
  createBundledUiHandler,
  createDetachedUiHandler,
  createPageFrameLoads,
  isPageFrameUrl,
  fromBundledPage,
  pageDocument,
  passThroughHeaders,
  routeRequest,
  servedByServer,
};
