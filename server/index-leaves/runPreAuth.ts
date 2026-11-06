// @ts-nocheck
/** runPreAuth (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRunPreAuth(getHost: () => Host): any {
async function runPreAuth(req: IncomingMessage, res: ServerResponse, url: URL, path: string, method: string) {
  const host = getHost();
  const { PRE_AUTH_ROUTES, json, readBody } = host;
  // ── who is asking (server/auth/request-auth.ts) ──────────────────────────
  // #1388 wave 4: public pre-auth routes (healthz, environment, mcp-oauth,
  // domain-check, email, invites, pair, companion pair). Dispatched before
  // serveStatic so /healthz never becomes the SPA.
  if (await dispatchPreAuthRoutes(PRE_AUTH_ROUTES, {
    req, res, url, path, method, auth: null, json, readBody,
  })) return true;
  // Published pages (/pages/...) are never the UI: the SPA fallback would
  // answer a page's address with the app itself, framed in the page's card
  // or opened from its link. handlePublishedPagePublic answers them below,
  // a page or an explicit 404 (isPagesPath).
  if (method === "GET" && !path.startsWith("/api/") && !path.startsWith("/.well-known/") && !isPagesPath(path) && host.serveStatic(res, path)) return true;
  // Inline video widgets: the signed token in the path is the
  // authorization (routes/media-widgets.ts), so AVPlayer, <video> and a
  // cast receiver can play without the session's header or cookie.
  if (await host.handleMediaProxy(req, res, path, method)) return true;
  // A bot template's public link: its signed token is the authorization
  // for one read-only template (routes/template-links.ts).
  if (host.handleTemplateLinkPublic(host.templateLinks, req, res, path, method)) return true;
  // A published page: served sandboxed (opaque origin, no network) to the
  // readers its person chose (routes/published-pages.ts).
  if (handlePublishedPagePublic(host.publishedPageOptions(), req, res, path, method)) return true;
  return false;

}
  return runPreAuth;
}
