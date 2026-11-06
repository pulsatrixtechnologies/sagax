// @ts-nocheck
/** publishedPageViewer (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPublishedPageViewer(getHost: () => Host): any {
function publishedPageViewer(req: IncomingMessage) {
  const host = getHost();
  const { isLoopbackHost, isProxied, parseCookies } = host;

  const cookie = parseCookies(typeof req.headers.cookie === "string" ? req.headers.cookie : undefined).get(host.SESSION_COOKIE);
  if (cookie) {
    const session = host.sessions.authenticate(cookie);
    // Not yet confirmed by the provider after a restart: only the main gate confirms it.
    if (!session || host.sessions.needsRecheck(session.id)) return null;
    if (host.IDENTITY.kind !== "perspicax") {
      return { computerOwner: host.computerOwner({ kind: "session", session, via: "cookie", scopes: session.scopes }) };
    }
    const person = session.principalId ? host.principals.byId(session.principalId) : null;
    if (!person || person.kind !== "human" || person.disabledAt !== undefined || person.consoleDisabled) return null;
    return { principalId: person.id, computerOwner: false };
  }
  const hostnameHostLocal = typeof req.headers.host === "string" ? req.headers.host : undefined;
  // A browser is never the owner by being on this computer (OpenMausBot
  // #2930 port): the desktop app's window proves itself with its header.
  if (host.IDENTITY.kind !== "perspicax" && host.LOOPBACK.trust !== "service" && !isProxied(req) && isLoopbackHost(hostnameHostLocal)
    && !loopbackBrowserRefused(req, { loopbackMutationToken: host.desktopMutationToken, trustLocalBrowser: host.LOOPBACK.localBrowsers })) return { computerOwner: true };
  return null;

}
  return publishedPageViewer;
}
