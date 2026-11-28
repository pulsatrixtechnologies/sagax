// The window's page while the local server is still loading.
//
// The packaged server opens its port before it loads (server/early-listener.ts)
// and the window opens on that, but the server's thread is busy evaluating a
// 13 MB bundle for about half a second: the page and its 200 scripts waited
// in the port meanwhile. This main process has nothing to do then, and the
// same files are in this app's bundle (Resources/ui, what the server serves).
//
// So, for the first page load only, the http scheme of the default session
// is taken over: GET / and /assets/* of the local origin come from the bundle,
// with the server's own headers (server/static-ui.ts). The first request for
// anything else (the API, another origin, a file the bundle does not hold)
// hands the scheme back at once and goes to the network; the caller's fetch
// must re-apply the desktop owner capability (protocol.handle skips
// webRequest; electron/boot-ui-forward.mjs, #5320). From then on Chromium
// talks to the server directly. Pure apart from the injected fetch and file
// reader, so node:test covers every rule.
import path from "node:path";

/** The server's headers for the UI (server/static-ui.ts PAGE_HEADERS and
 * serveStaticUi); boot-ui.node-test.mjs checks they still match. */
export const PAGE_HEADERS = Object.freeze({ "content-security-policy": "frame-ancestors 'none'", "x-frame-options": "DENY", "referrer-policy": "no-referrer" });
export const ASSET_CACHE = "public, max-age=31536000, immutable";

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".mp3": "audio/mpeg",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
};

/** The bundle file for a UI request of the local origin, or null. */
export function bootUiFile(request, origin, staticDir) {
  if (!origin || !staticDir) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  if (url.pathname !== "/" && !url.pathname.startsWith("/assets/")) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("..")) return null;
  const root = path.resolve(staticDir);
  const file = path.resolve(root, decoded === "/" ? "index.html" : decoded.replace(/^\/+/, ""));
  if (!file.startsWith(root + path.sep)) return null;
  const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const headers = type === "text/html"
    ? { "content-type": type, "cache-control": "no-cache", ...PAGE_HEADERS }
    : { "content-type": type, "cache-control": ASSET_CACHE };
  return { file, headers };
}

/**
 * @param {{
 *   origin: () => string | null,   the local server's origin
 *   staticDir: string,             the built UI (Resources/ui)
 *   readFile: (file: string) => Promise<Uint8Array>,
 *   fetch: (request: Request, init: object) => Promise<Response>,  net.fetch
 *   release: () => void,           give the scheme back (protocol.unhandle)
 * }} deps
 */
export function createBootUiHandler(deps) {
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    deps.release();
  };
  const handler = async (request) => {
    const target = released ? null : bootUiFile(request, deps.origin(), deps.staticDir);
    if (target) {
      try {
        const data = await deps.readFile(target.file);
        return new Response(request.method === "HEAD" ? null : data, { status: 200, headers: target.headers });
      } catch {
        // not in the bundle: the server answers it (its fallback, a 404)
      }
    }
    release();
    return deps.fetch(request, { bypassCustomProtocolHandlers: true });
  };
  return { handler, release, get released() { return released; } };
}
