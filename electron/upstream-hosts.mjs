// Hosts Sagax must never reach: the original OpenMausBot project's services
// (cloud, accounts, admin, companion tunnels, the site, under every domain
// below), third-party analytics, and the upstream author's GitHub repositories.
// One list for the desktop app (electron/main.mjs installs it on every
// session and on main's own fetch) and the server (server/network-guard.ts).
// scripts/check-no-phone-home.mjs greps the built bundles for the same hosts.

/** Registrable domains blocked with every subdomain. */
export const BLOCKED_DOMAINS = Object.freeze([
  "openmausbot.com",
  "openmausbot.ai",
  "openmausbot.app",
  "openmausbot.dev",
  "mausbot.si",
  "posthog.com",
]);

/** GitHub owners whose repositories (code, raw files, releases) are refused. */
export const BLOCKED_GITHUB_OWNERS = Object.freeze(["milind-soni"]);

const GITHUB_HOSTS = new Set([
  "github.com",
  "api.github.com",
  "raw.githubusercontent.com",
  "codeload.github.com",
  "objects.githubusercontent.com",
]);

function hostOf(value) {
  try {
    return new URL(String(value)).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

/** True for a host in a blocked domain family. */
export function isBlockedHost(host) {
  const name = String(host ?? "").toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  return BLOCKED_DOMAINS.some((domain) => name === domain || name.endsWith(`.${domain}`));
}

/** True for a URL Sagax must not request. */
export function isBlockedUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return false;
  }
  if (isBlockedHost(url.hostname)) return true;
  if (!GITHUB_HOSTS.has(url.hostname.toLowerCase())) return false;
  const segments = url.pathname.split("/").filter(Boolean).map((part) => part.toLowerCase());
  const owner = url.hostname === "api.github.com" && segments[0] === "repos" ? segments[1] : segments[0];
  return BLOCKED_GITHUB_OWNERS.includes(owner ?? "");
}

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input?.url ?? "";
}

// A test audit (server/testing/network-audit.mjs) listens here to prove that
// nothing even tried to reach a blocked host.
const AUDIT = Symbol.for("sagax.networkAudit");
export function reportBlocked(url) {
  try {
    globalThis[AUDIT]?.({ kind: "refused", host: hostOf(url) || String(url) });
  } catch {
    /* an audit must never change behavior */
  }
}

export class BlockedHostError extends Error {
  constructor(url) {
    super(`Sagax does not contact ${hostOf(url) || "this address"}.`);
    this.name = "BlockedHostError";
    this.code = "ERR_SAGAX_BLOCKED_HOST";
  }
}

/** A fetch that refuses blocked URLs before any connection is opened. */
export function guardFetch(fetcher) {
  if (typeof fetcher !== "function" || fetcher.sagaxGuarded) return fetcher;
  const guarded = function sagaxGuardedFetch(input, init) {
    const url = requestUrl(input);
    if (isBlockedUrl(url)) {
      reportBlocked(url);
      return Promise.reject(new BlockedHostError(url));
    }
    return fetcher.call(this, input, init);
  };
  Object.defineProperty(guarded, "sagaxGuarded", { value: true });
  return guarded;
}

/** Replace globalThis.fetch with the guarded one (idempotent). */
export function installFetchGuard(scope = globalThis) {
  if (typeof scope.fetch === "function") scope.fetch = guardFetch(scope.fetch);
  return scope.fetch;
}

/** URL patterns for Electron's webRequest filter. */
export function blockedRequestPatterns() {
  return [
    ...BLOCKED_DOMAINS.flatMap((domain) => [`*://${domain}/*`, `*://*.${domain}/*`]),
    ...BLOCKED_GITHUB_OWNERS.flatMap((owner) => [
      `*://github.com/${owner}/*`,
      `*://raw.githubusercontent.com/${owner}/*`,
      `*://codeload.github.com/${owner}/*`,
      `*://api.github.com/repos/${owner}/*`,
    ]),
  ];
}

/** Cancel every request a session makes to a blocked URL. Electron allows one
 * onBeforeRequest listener per session, and no other code in this app sets
 * one; the callback double-checks with isBlockedUrl. `alsoCancel` is the
 * second rule that shares this one listener (electron/server-session.mjs:
 * only the app window's session reaches the local server); with it, the
 * listener sees every URL instead of the blocked patterns alone. */
export function installSessionBlock(session, log = () => {}, alsoCancel = null) {
  if (!session?.webRequest || session.sagaxBlocked) return;
  const listener = (details, callback) => {
    const cancel = isBlockedUrl(details.url);
    if (cancel) {
      reportBlocked(details.url);
      log(`blocked request to ${hostOf(details.url)}`);
    }
    callback({ cancel: cancel || Boolean(alsoCancel?.(details.url)) });
  };
  if (alsoCancel) session.webRequest.onBeforeRequest(listener);
  else session.webRequest.onBeforeRequest({ urls: blockedRequestPatterns() }, listener);
  try {
    Object.defineProperty(session, "sagaxBlocked", { value: true });
  } catch {
    /* sealed session object: the listener is installed either way */
  }
}
