// The person's own memory sync token, for Settings > Memory of the desktop
// app (2026-10-14). The desktop used to ask for a token minted by hand in
// the Perspicax console; it now asks this server, as the person signed in:
//
//   GET  /api/me/memory-sync-token   who the token would be for: { person }
//                                    (no token; the desktop checks the person
//                                    signed in is still the copy's)
//   POST /api/me/memory-sync-token   { server, token, expiresAt }
//
// The server asks its Perspicax, with the link token, for the memory sync
// token of the session's own provider account
// (POST /api/v1/pulsabot/people/{sub}/memory-sync-token, Perspicax 1.8.27):
// the same token the person's console mints (scope memory_sync, 90 days, one
// per person, the previous one revoked), audited by Perspicax under this
// server. Rules, none optional:
//
//   - the subject is the session's own `idp.sub`, never a body field, a
//     query or another person's: a session can only ever get its own token;
//   - only a session from this server's issuer; a local request, a paired
//     device without a provider account or a solo server answer 403;
//   - the token is answered once, `Cache-Control: no-store`, to the desktop
//     app's main process (electron/org-memory-cache.mjs), and never logged:
//     failures are logged by kind only;
//   - at most MINT_PER_MINUTE mints per person per minute (each mint revokes
//     the previous token).
import type { LinkPostLimits, LinkPostResult } from "../perspicax-link.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "../routes/table.ts";

export const MEMORY_SYNC_TOKEN_ROUTE = "/api/me/memory-sync-token";
export const MINT_PATH = (sub: string) => `/api/v1/pulsabot/people/${encodeURIComponent(sub)}/memory-sync-token`;
export const MINT_TIMEOUT_MS = 10_000;
export const MINT_MAX_BYTES = 8 * 1024;
export const MINT_PER_MINUTE = 6;
const TOKEN = /^pxat1\.[A-Za-z0-9_-]{16,200}$/;

export interface MemorySyncTokenRouteDeps {
  /** SAGAX_PERSPICAX_ISSUER: the Perspicax people sign in with. */
  issuer: string;
  /** A link-authenticated POST to Perspicax (PerspicaxDirectory.linkPostJson),
   * or null when no link file is set. */
  linkPost: ((path: string, body: unknown, limits: LinkPostLimits) => Promise<LinkPostResult>) | null;
  log?: (line: string) => void;
  now?: () => number;
}

const trim = (value: string) => value.replace(/\/+$/, "");
const originOf = (value: string): string | null => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

/** The sub of a session signed in with this issuer, or null. */
export function ownSubject(auth: RequestAuth, issuer: string): string | null {
  if (auth.kind !== "session") return null;
  const idp = auth.session.idp;
  if (!auth.session.principalId?.trim() || !idp?.sub || trim(idp.iss) !== trim(issuer)) return null;
  return idp.sub;
}

export function createMemorySyncTokenRoute(deps: MemorySyncTokenRouteDeps): RouteHandler {
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? (() => {});
  const recent = new Map<string, number[]>();
  const loggedKinds = new Set<string>();
  const logOnce = (kind: string) => {
    if (loggedKinds.has(kind)) return;
    loggedKinds.add(kind);
    log(`[perspicax] memory sync token: ${kind}`);
  };
  return async ({ res, path, method, auth, json }) => {
    if (path !== MEMORY_SYNC_TOKEN_ROUTE) return PASS;
    res.setHeader("cache-control", "no-store");
    if (method !== "POST" && method !== "GET") return json(res, 405, { error: "method not allowed" });
    if (auth.kind !== "session") return json(res, 401, { error: "Sign in with Pulsatrix first.", code: "session_required" });
    const sub = ownSubject(auth, deps.issuer);
    const server = originOf(deps.issuer);
    if (!sub || !server) return json(res, 403, { error: "The memory sync needs a person signed in with Pulsatrix.", code: "identity_perspicax" });
    if (method === "GET") return json(res, 200, { person: auth.session.principalId!.trim() });
    if (!deps.linkPost) return json(res, 503, { error: "This server is not linked to Perspicax yet.", code: "link" });
    const at = now();
    const times = (recent.get(sub) ?? []).filter((time) => at - time < 60_000);
    if (times.length >= MINT_PER_MINUTE) return json(res, 429, { error: "Too many memory sync tokens asked; try again in a minute.", code: "rate_limited" });
    times.push(at);
    recent.set(sub, times);
    // The person's own token goes with the link token (2026-10-28).
    const answer = await deps.linkPost(MINT_PATH(sub), {}, { timeoutMs: MINT_TIMEOUT_MS, maxBytes: MINT_MAX_BYTES, subject: sub });
    if (answer.ok) {
      const body = answer.body && typeof answer.body === "object" ? (answer.body as Record<string, unknown>) : {};
      const info = body.info && typeof body.info === "object" ? (body.info as Record<string, unknown>) : {};
      const token = typeof body.token === "string" ? body.token : "";
      if (!TOKEN.test(token)) {
        logOnce("Perspicax answered without a valid token");
        return json(res, 502, { error: "Perspicax did not answer a memory sync token.", code: "unreachable" });
      }
      const expiresAt = typeof info.expires_at === "string" && Number.isFinite(Date.parse(info.expires_at)) ? new Date(Date.parse(info.expires_at)).toISOString() : null;
      return json(res, 200, { server, token, expiresAt });
    }
    const code = answer.body && typeof answer.body === "object" ? (answer.body as { error?: unknown }).error : undefined;
    if (answer.error === "link") {
      logOnce("the link token was refused");
      return json(res, 503, { error: "Perspicax refused this server's link.", code: "link" });
    }
    if (answer.error === "refused" && answer.status === 404 && code === "no_person") {
      return json(res, 403, { error: "You are no longer a person of this organization in Perspicax.", code: "not_member" });
    }
    if (answer.error === "refused" && answer.status === 409) {
      return json(res, 403, { error: "Your Perspicax account is disabled.", code: "not_member" });
    }
    if (answer.error === "refused" && answer.status === 404) {
      logOnce("this Perspicax does not mint memory sync tokens for a linked server (1.8.27 or later does)");
      return json(res, 404, { error: "This Perspicax does not set up the memory sync automatically yet.", code: "unsupported" });
    }
    if (answer.error === "refused" && answer.status === 429) {
      return json(res, 429, { error: "Perspicax asks to wait; try again in a minute.", code: "rate_limited" });
    }
    logOnce(`Perspicax did not answer (${answer.error}${answer.status ? ` ${answer.status}` : ""})`);
    return json(res, 502, { error: "Perspicax could not be reached.", code: "unreachable" });
  };
}
