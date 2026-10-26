// "Sign in with Pulsatrix": the organization server's OpenID Connect login.
//
// SAGAX_IDENTITY=perspicax turns it on. The server then:
//   - answers GET /auth/oidc/start (302 to the Perspicax authorize page) and
//     GET /auth/oidc/callback (code exchange and id_token check in
//     server/oidc-rp.ts, then a Sagax session cookie and 302 to /);
//     `fresh=1` on the start is "Sign in again": `prompt=login` and
//     `max_age=0` at Perspicax. Any sign-in stamps the session's `authAt`
//     only from the id_token's verified `auth_time` when it is recent
//     (server/recent-sign-in.ts authAtFromAuthTime);
//   - resolves the person by (iss, sub) through PrincipalRegistry.forSubject;
//   - maps the `role` claim: admin -> scopes ["admin", "client"] and the
//     organization role "admin"; manager and employee -> ["client"] and
//     "member"; anything else (a service account, no claim) cannot sign in;
//   - refuses the interim email codes and invitation links, and says so in
//     its environment descriptor so /pair offers only this button;
//   - keeps the provider's refresh token as the session's grant
//     (server/idp-session.ts) and answers POST
//     /api/auth/oidc/backchannel-logout (OpenID Connect Back-Channel Logout;
//     a token that also carries the RISC account purged event erases the
//     person's data here and answers `{ purged: true, bots, threads }`);
//   - signs the desktop app and the phones in through the system browser:
//     /auth/oidc/start?client=desktop|phone ends on a sagax:// (phone) or
//     openmausbot:// / sagax:// (desktop) link
//     carrying a two-minute, single-use pairing credential bound to the
//     person (slice 2); a phone that names `&return=sagax` gets the same
//     invite on sagax://pair instead, and a refused sign-in on
//     sagax://pair?error=<code> (the app's authentication sheet only ever
//     sees its own scheme, never the web /pair page);
//   - answers GET /auth/oidc/reauth?ticket= (2026-10-18, account deletion,
//     server/account-reauth.ts): the person signs in again (`prompt=login`,
//     `max_age=0`) and the callback keeps that sign-in's access token for
//     their DELETE /api/me; it ends on /#account-reauth=ok (web) or
//     sagax://account-reauth?status=ok (phone), refusals on
//     /#account-reauth-error=<code> or sagax://account-reauth?error=<code>;
//   - or, for the desktop app, on its loopback listener (RFC 8252 7.3):
//     /auth/oidc/start?client=desktop&return=http://127.0.0.1:<port>/<state>
//     ends on that address with the credential in the fragment, which a
//     browser never sends to any server and so never reaches a log.
//
// Configuration (environment only, read once at boot):
//   SAGAX_IDENTITY=perspicax
//   SAGAX_PERSPICAX_ISSUER   issuer URL, e.g. https://px.example.com
//   SAGAX_OIDC_CLIENT_ID     client id, default "pulsa-bot"
//   SAGAX_PUBLIC_URL         this server's public origin; the redirect URI is
//                          <SAGAX_PUBLIC_URL>/auth/oidc/callback and the login
//                          access token's resource is this origin.
//   SAGAX_PERSPICAX_INTERNAL_URL  optional origin (http or https, any host)
//                          where this server reaches Perspicax from inside
//                          the deployment: discovery, JWKS, token, revoke and
//                          directory calls go there (slice 3).
//
// Spec: docs/superpowers/specs/2026-09-29-perspicax-multiuser-design.md,
// sections 2, 3 and 10 (slice 1).
import type { IncomingMessage, ServerResponse } from "node:http";

import { ACCOUNT_REAUTH_PATH, phoneReauthReturn, webReauthReturn, type AccountReauth, type AccountReauthClient } from "./account-reauth.ts";
import { immediateRevocations, type RevocationSink } from "./idp-revocations.ts";
import { ACCOUNT_ERASURE_SCOPE, OidcRelyingParty, ROUTINE_DELEGATION_SCOPE, validInternalBase, validIssuer, type OidcClientKind, type OidcIdentity } from "./oidc-rp.ts";
import type { Principal } from "./principals.ts";
import { authAtFromAuthTime } from "./recent-sign-in.ts";
import { cookieMaxAgeSeconds, type PublicSession, type Scope, type SessionRecord } from "./sessions.ts";
import { labelFromUserAgent, parseCookies, serializeSessionCookie } from "./request-auth.ts";

export const OIDC_START_PATH = "/auth/oidc/start";
export const OIDC_CALLBACK_PATH = "/auth/oidc/callback";
export const OIDC_BACKCHANNEL_LOGOUT_PATH = "/api/auth/oidc/backchannel-logout";
/** A desktop or phone sign-in's pairing credential lives this long. */
export const OIDC_NATIVE_PAIRING_TTL_MS = 120_000;
/** Its grant is revoked by the sweep this long after the credential expires. TTL + grace + the
 * sweep slack stays well under three minutes from the start of the flow (unredeemed grant). */
export const OIDC_NATIVE_BIND_GRACE_MS = 30_000;
export const BACKCHANNEL_MAX_BODY_BYTES = 16 * 1024;
const JTI_CACHE_MAX = 10_000;
const JTI_CACHE_EXTRA_MS = 60_000;
export const DEFAULT_OIDC_CLIENT_ID = "pulsa-bot";

export type IdentityConfig =
  | { kind: "solo" }
  | { kind: "perspicax"; issuer: string; clientId: string; publicOrigin: string; redirectUri: string; internalBase?: string };

/** What /.well-known/openmausbot/environment says about sign-in. */
export interface IdentityDescriptor {
  kind: "perspicax";
  protocol: "oidc";
  issuer: string;
  /** Same-origin path that starts the sign-in. */
  loginPath: string;
  /** The start path takes `?client=desktop|phone` and ends on an
   * openmausbot:// link (slice 2), so native apps may use the system browser. */
  nativeReturn: true;
  /** The desktop start also takes `&return=<loopback URL>` and ends there
   * (validLoopbackReturn), so the app that started the sign-in gets it back
   * whichever app owns openmausbot://. */
  loopbackReturn: true;
  /** Schemes a native return may use: openmausbot://auth by default,
   * sagax://auth when the desktop start names `return=<sagaxReturnLink>`. */
  nativeReturnSchemes: readonly ["sagax", "openmausbot"];
  /** Schemes a phone start may name with `&return=`: `sagax` ends on
   * sagax://pair (success and refusal alike); none keeps openmausbot://pair. */
  phoneReturnSchemes: readonly ["sagax", "openmausbot"];
}

/** The `return` a phone sign-in names to come back on sagax://pair. */
export const PHONE_SAGAX_RETURN = "sagax";

/** The loopback return a desktop sign-in may name: http on 127.0.0.1 or
 * [::1], an explicit port, and one path segment of 32 to 128 URL-safe
 * characters (the listener's random state). Never a host name (not even
 * localhost), a query, a fragment or credentials. Returns the canonical URL
 * or null. */
const LOOPBACK_RETURN = /^http:\/\/(127\.0\.0\.1|\[::1\]):([1-9][0-9]{3,4})\/([A-Za-z0-9_-]{32,128})$/;
export function validLoopbackReturn(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length > 200) return null;
  const match = LOOPBACK_RETURN.exec(value);
  if (!match) return null;
  const port = Number(match[2]);
  if (port < 1024 || port > 65535) return null;
  return `http://${match[1]}:${port}/${match[3]}`;
}

/** Read the identity mode from the environment. A half-configured
 * organization server refuses to start rather than fall back to email codes. */
export function identityConfigFromEnv(env: NodeJS.ProcessEnv = process.env): IdentityConfig {
  const mode = env.SAGAX_IDENTITY?.trim().toLowerCase();
  if (!mode || mode === "solo") return { kind: "solo" };
  if (mode !== "perspicax") throw new Error(`SAGAX_IDENTITY="${mode.replace(/[^\w.-]/g, "").slice(0, 40)}" is not supported; use perspicax or leave it unset.`);
  const issuer = validIssuer(env.SAGAX_PERSPICAX_ISSUER ?? "");
  if (!issuer) throw new Error("SAGAX_IDENTITY=perspicax needs SAGAX_PERSPICAX_ISSUER: the Perspicax https URL (http only on this machine).");
  const publicUrl = env.SAGAX_PUBLIC_URL?.trim().replace(/\/+$/, "");
  let publicOrigin: string;
  try {
    const url = new URL(publicUrl ?? "");
    const loopback = url.hostname === "localhost" || url.hostname.startsWith("127.") || url.hostname === "[::1]";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("scheme");
    if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error("path");
    publicOrigin = url.origin;
  } catch {
    throw new Error("SAGAX_IDENTITY=perspicax needs SAGAX_PUBLIC_URL: this server's public https origin (http only on this machine), with no path.");
  }
  const clientId = env.SAGAX_OIDC_CLIENT_ID?.trim() || DEFAULT_OIDC_CLIENT_ID;
  let internalBase: string | undefined;
  if (env.SAGAX_PERSPICAX_INTERNAL_URL?.trim()) {
    internalBase = validInternalBase(env.SAGAX_PERSPICAX_INTERNAL_URL) ?? undefined;
    if (!internalBase) throw new Error("SAGAX_PERSPICAX_INTERNAL_URL must be an http or https origin with no path, e.g. http://perspicax:8787.");
  }
  return { kind: "perspicax", issuer, clientId, publicOrigin, redirectUri: `${publicOrigin}${OIDC_CALLBACK_PATH}`, ...(internalBase ? { internalBase } : {}) };
}

export function identityDescriptor(config: IdentityConfig): IdentityDescriptor | undefined {
  return config.kind === "perspicax" ? { kind: "perspicax", protocol: "oidc", issuer: config.issuer, loginPath: OIDC_START_PATH, nativeReturn: true, loopbackReturn: true, nativeReturnSchemes: ["sagax", "openmausbot"], phoneReturnSchemes: ["sagax", "openmausbot"] } : undefined;
}

/** Session scopes for a Perspicax role (spec section 3). No claim is an
 * employee: Perspicax in file mode has one kind of account and sends none.
 * Any other value (a role this build does not know) cannot sign in. */
export function scopesForRole(role: string | undefined): Scope[] | null {
  if (role === "admin") return ["admin", "client"];
  if (role === undefined || role === "manager" || role === "employee") return ["client"];
  return null;
}

/** The Sagax organization role for a Perspicax role. */
export function orgRoleForRole(role: string | undefined): "admin" | "member" | null {
  if (role === "admin") return "admin";
  if (role === undefined || role === "manager" || role === "employee") return "member";
  return null;
}

/** The interim sign-in paths an organization server refuses: email codes
 * and every invitation route (issue, revoke, accept, preview, join). */
export function isInterimSignInRoute(method: string, path: string): boolean {
  if (method === "POST" && (path === "/api/auth/email/start" || path === "/api/auth/email/verify")) return true;
  return path === "/api/org/invites" || path.startsWith("/api/org/invites/");
}

export const INTERIM_SIGNIN_REFUSAL = {
  error: "This server signs people in with Pulsatrix. Email codes and invitation links are off; an admin creates accounts in Perspicax.",
  code: "identity_perspicax",
} as const;

/** Who owns a signed-in person's name and email on this server. On an
 * organization server it is Perspicax: the person's name and email come from
 * the id_token and the directory, are refreshed on every sign-in and token
 * refresh, and are changed in the issuer's console (`/console/me`), never
 * here. A solo server owns its profile (null). */
export interface ProfileManagement {
  profileManagedBy: "perspicax";
  /** The issuer console's own profile page. */
  profileManageUrl: string;
}

export function profileManagement(config: IdentityConfig): ProfileManagement | null {
  if (config.kind !== "perspicax") return null;
  let origin: string;
  try {
    origin = new URL(config.issuer).origin;
  } catch {
    return null;
  }
  return { profileManagedBy: "perspicax", profileManageUrl: `${origin}/console/me` };
}

/** A config patch that writes a profile's name or email: refused for a
 * person whose profile Perspicax manages (403 identity_perspicax). The rest
 * of the profile (about me, photo) is Sagax's own and stays writable. */
export function writesManagedProfile(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const profile = (body as { profile?: unknown }).profile;
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return false;
  return Object.hasOwn(profile, "name") || Object.hasOwn(profile, "email");
}

export const MANAGED_PROFILE_REFUSAL = {
  error: "Your name and email come from your organization (Pulsatrix Perspicax). Change them in Perspicax.",
  code: "identity_perspicax",
} as const;

/** Extra fields for GET /api/auth/session on a session from this sign-in. */
export function oidcSessionFields(session: SessionRecord, principal: Principal | null, teamName?: (id: string) => string | undefined): Record<string, unknown> {
  if (!session.idp) return {};
  return {
    identity: "perspicax",
    ...(session.principalId ? { principalId: session.principalId } : {}),
    ...(principal?.email ? { email: principal.email } : {}),
    ...(principal?.name ? { name: principal.name } : {}),
    ...(principal?.login ? { login: principal.login } : {}),
    ...(session.idp.role ? { role: session.idp.role } : {}),
    ...(principal?.orgRole ? { orgRole: principal.orgRole } : {}),
    // Slice 4: the Perspicax role and teams (member or manager).
    ...(principal?.perspicaxRole ? { perspicaxRole: principal.perspicaxRole } : {}),
    teams: (principal?.teams ?? []).map((team) => ({ id: team.id, name: teamName?.(team.id) ?? team.id, manager: team.manager })),
  };
}

/** The grant side of a sign-in (server/idp-session.ts IdpSessionManager). */
export interface OidcGrantKeeper {
  unavailableReason(): string | null;
  /** `accessToken` stays in memory only (slice 5 token exchange). */
  createGrant(input: { iss: string; sub: string; refreshToken: string; bindBy: number; accessToken?: string; accessExpiresAt?: number }): string;
  bindSession(grantRef: string, sessionId: string): boolean;
  discard(grantRef: string): void;
  backchannelLogout(input: { iss: string; sub: string }): { sessions: number; pairings: number };
  /** Slice 6: keep a routine delegation (RoutineConsents.create). Absent:
   * a delegation callback answers `unavailable`. */
  createRoutineDelegation?(input: { principalId: string; iss: string; sub: string; refreshToken: string; accessToken?: string; accessExpiresAt?: number }): void;
  /** Slice 6: the principal of a live session, or null when it is gone. */
  sessionPrincipal?(sessionId: string): string | null;
  /** 2026-10-08: a person signed in (web, desktop or phone). Their routine
   * delegation is issued from this access token when they hold none, with
   * no consent step (RoutineConsents.keepAlive). Fire and forget. */
  signedIn?(input: { principalId: string; accessToken?: string; accessExpiresAt?: number }): void;
  /** 2026-10-17: the logout token also carried the account purged event
   * (ACCOUNT_PURGED_EVENT): Perspicax erased the account, so erase the
   * person's data on this server, as DELETE /api/me does. Idempotent: a
   * person this server never knew, or already erased, is zeros. Throws when
   * the erasure did not run; the provider then retries. Absent: the push is
   * answered as a plain logout (`{}`), which the provider keeps retrying. */
  purgePerson?(input: { iss: string; sub: string }): Promise<{ bots: number; threads: number }>;
}

/** The browser binding cookie of a sign-in or delegation flow: the same
 * name and attributes wherever a flow starts (slice 6 starts one from
 * POST /api/org/routine-delegation). */
export function oidcBindingCookie(sessionCookie: string, redirectUri: string, binding: string | null): string {
  const attributes = `Path=/auth/oidc; HttpOnly; SameSite=Lax${redirectUri.startsWith("https://") ? "; Secure" : ""}`;
  return binding === null ? `${sessionCookie}_oidc=; ${attributes}; Max-Age=0` : `${sessionCookie}_oidc=${binding}; ${attributes}; Max-Age=600`;
}

/** Slice 6: where a routine delegation flow lands in the web app. */
export function routineDelegationReturn(outcome: { ok: true } | { error: string }): string {
  return "ok" in outcome ? "/#routine-delegation=ok" : `/#routine-delegation-error=${encodeURIComponent(outcome.error)}`;
}

export interface OidcLoginDeps {
  config: Extract<IdentityConfig, { kind: "perspicax" }>;
  rp?: OidcRelyingParty;
  /** The Sagax session cookie name (server/request-auth.ts). */
  sessionCookie: string;
  forSubject: (input: { iss: string; sub: string; claims: { email?: string; name?: string; login?: string; avatar?: string }; orgRole: "admin" | "member"; teams?: { id: string; name: string; manager: boolean }[]; perspicaxRole?: "admin" | "manager" | "employee" }) => Principal;
  /** `authAt`: the provider's verified, recent `auth_time`; absent when the
   * id_token gave none that counts (server/recent-sign-in.ts). */
  issueSession: (input: { label: string; scopes: Scope[]; email?: string; principalId: string; idp: NonNullable<SessionRecord["idp"]>; authAt?: number }) => { token: string; session: PublicSession };
  /** Where each sign-in's refresh token is kept. */
  grants: OidcGrantKeeper;
  /** A principal-bound pairing credential for a desktop or phone sign-in. */
  openPairing: (input: { principalId: string; scopes: Scope[]; ttlMs: number; label: string; idp: NonNullable<SessionRecord["idp"]>; authAt?: number }) => { credential: string; expiresAt: number };
  /** This server's name, for the phone's saved server. */
  serverName: () => string;
  now?: () => number;
  log?: (line: string) => void;
  /** Where the refresh token of a refused sign-in or delegation is revoked
   * (the durable queue, server/idp-revocations.ts); a single call now
   * without one. */
  revocations?: RevocationSink;
  /** 2026-10-18: the tickets and fresh sign-ins of account deletion. Absent:
   * GET /auth/oidc/reauth answers `unavailable`. */
  reauth?: AccountReauth;
}

function redirect(res: ServerResponse, location: string, cookies: string[]): void {
  res.writeHead(303, {
    location,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    ...(cookies.length ? { "set-cookie": cookies } : {}),
  });
  res.end();
}

function parseClient(value: string | null): OidcClientKind | null {
  if (value === null || value === "web") return "web";
  return value === "desktop" || value === "phone" ? value : null;
}

/** The sagax:// return a desktop start may name instead of a loopback
 * listener. Compared exactly: it can only ever point back at this server. */
export function sagaxReturnLink(publicOrigin: string): string {
  return `sagax://auth?origin=${encodeURIComponent(publicOrigin)}`;
}

/** The link the desktop app receives from the system browser: its loopback
 * listener or sagax:// return when the sign-in named one, else
 * openmausbot://auth (a desktop that predates sagax://). The
 * credential always rides in the fragment. */
export function desktopReturnLink(publicOrigin: string, outcome: { code: string } | { error: string }, returnTo?: string): string {
  const fragment = "code" in outcome ? `#code=${outcome.code}` : `#error=${encodeURIComponent(outcome.error)}`;
  if (returnTo) return `${returnTo}${fragment}`;
  return `openmausbot://auth?origin=${encodeURIComponent(publicOrigin)}${fragment}`;
}

/** The link a phone's authentication sheet receives: the invite shape both
 * phone apps parse (sagax://pair?address=&token=&name=). Every phone link
 * is on sagax:// now; `returnTo` (`return=sagax`) is still accepted from
 * older starts and changes nothing. */
export function phoneReturnLink(publicOrigin: string, credential: string, serverName: string, _returnTo?: string): string {
  return `sagax://pair?address=${encodeURIComponent(publicOrigin)}&token=${encodeURIComponent(credential)}&name=${encodeURIComponent(serverName)}`;
}

/** A refused phone sign-in that named `return=sagax`: the app's sheet ends
 * on its own scheme with the reason, rather than on the web /pair page. */
export function phoneErrorLink(publicOrigin: string, code: string): string {
  return `sagax://pair?address=${encodeURIComponent(publicOrigin)}&error=${encodeURIComponent(code)}`;
}

function jsonAnswer(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...extra });
  res.end(JSON.stringify(body));
}

/** The raw body up to `max` bytes, or null when it is larger. */
function readRawBody(req: IncomingMessage, max: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > max) {
        over = true;
        resolve(null);
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => { if (!over) resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", reject);
  });
}

/** GET /auth/oidc/start and GET /auth/oidc/callback, and POST
 * /api/auth/oidc/backchannel-logout. Public, answered before the auth gate:
 * the pending flow's state, nonce, PKCE verifier and browser binding are the
 * authorization of the first two, the provider's signature that of the
 * third. Returns whether it answered. */
export function createOidcLoginRoutes(deps: OidcLoginDeps) {
  const rp = deps.rp ?? new OidcRelyingParty({
    issuer: deps.config.issuer,
    clientId: deps.config.clientId,
    redirectUri: deps.config.redirectUri,
    resource: deps.config.publicOrigin,
    ...(deps.config.internalBase ? { internalBase: deps.config.internalBase } : {}),
  });
  const secure = deps.config.redirectUri.startsWith("https://");
  const bindingCookie = `${deps.sessionCookie}_oidc`;
  const clearBinding = oidcBindingCookie(deps.sessionCookie, deps.config.redirectUri, null);
  const log = deps.log ?? ((line: string) => console.warn(line));
  const now = deps.now ?? Date.now;
  const origin = deps.config.publicOrigin;
  const revocations = deps.revocations ?? immediateRevocations((token, hint) => rp.revokeToken(token, hint), log, "oidc");
  const fail = (res: ServerResponse, code: string, cookies: string[] = [], client: OidcClientKind = "web", returnTo?: string) =>
    redirect(res, client === "desktop" ? desktopReturnLink(origin, { error: code }, returnTo)
      : client === "phone" && returnTo === PHONE_SAGAX_RETURN ? phoneErrorLink(origin, code)
      : `/pair#signin_error=${encodeURIComponent(code)}`, cookies);
  /** Logout token ids already honoured, until they expire (+60 s). */
  const seenJti = new Map<string, number>();

  const backchannel = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const refuse = (reason: string) => {
      log(`oidc back-channel logout refused: ${reason}`);
      jsonAnswer(res, 400, { error: "invalid_request" });
    };
    const type = String(req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (type !== "application/x-www-form-urlencoded") {
      req.resume();
      return refuse("not a form post");
    }
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > BACKCHANNEL_MAX_BODY_BYTES) {
      req.resume();
      return refuse("body too large");
    }
    let raw: string | null;
    try {
      raw = await readRawBody(req, BACKCHANNEL_MAX_BODY_BYTES);
    } catch {
      return refuse("body could not be read");
    }
    if (raw === null) return refuse("body too large");
    const token = new URLSearchParams(raw).get("logout_token");
    if (!token) return refuse("no logout_token");
    let claims;
    try {
      claims = await rp.verifyLogoutToken(token);
    } catch (error) {
      return refuse(error instanceof Error ? error.message : String(error));
    }
    const at = now();
    for (const [jti, until] of seenJti) if (until <= at) seenJti.delete(jti);
    if (seenJti.has(claims.jti)) return refuse("replayed logout token");
    while (seenJti.size >= JTI_CACHE_MAX) {
      const oldest = seenJti.keys().next().value;
      if (oldest === undefined) break;
      seenJti.delete(oldest);
    }
    seenJti.set(claims.jti, claims.exp * 1000 + JTI_CACHE_EXTRA_MS);
    const done = deps.grants.backchannelLogout({ iss: claims.iss, sub: claims.sub });
    log(`oidc back-channel logout: subject ${claims.sub.slice(0, 64)}, ${done.sessions} session(s) revoked, ${done.pairings} pairing code(s) cancelled`);
    // 2026-10-17: the account was erased at the provider. `purged: true`
    // only once the data erasure ran: the provider counts that answer, and
    // nothing else, as delivered (a 500 is retried with a fresh jti).
    if (claims.purged && deps.grants.purgePerson) {
      let removed: { bots: number; threads: number };
      try {
        removed = await deps.grants.purgePerson({ iss: claims.iss, sub: claims.sub });
      } catch (error) {
        log(`oidc account purge failed for subject ${claims.sub.slice(0, 64)}: ${error instanceof Error ? error.message : String(error)}`);
        return jsonAnswer(res, 500, { error: "purge_failed" });
      }
      log(`oidc account purge: subject ${claims.sub.slice(0, 64)}, ${removed.bots} bot(s) and ${removed.threads} thread(s) erased`);
      return jsonAnswer(res, 200, { purged: true, bots: removed.bots, threads: removed.threads });
    }
    jsonAnswer(res, 200, {});
  };

  /** Slice 6 (D10): a routine delegation comes back. It must carry the
   * marker, be the subject and the live session that started it, and hold a
   * refresh token; any refusal revokes what the provider gave. */
  const delegationCallback = (res: ServerResponse, outcome: Extract<Awaited<ReturnType<OidcRelyingParty["callback"]>>, { ok: true }>): void => {
    const identity = outcome.identity;
    const refreshToken = outcome.grant.refreshToken;
    const expect = outcome.expect;
    const refuse = (code: string, why: string) => {
      log(`oidc routine delegation refused (${code}): ${why}`);
      if (refreshToken) revocations.enqueue(refreshToken, "refresh_token", `a refused routine delegation (${code})`);
      redirect(res, routineDelegationReturn({ error: code }), [clearBinding]);
    };
    if (!expect) return refuse("routines_session", "the flow did not remember who started it");
    // The subject first: Perspicax drops the marker for another account.
    if (identity.iss !== expect.subject.iss || identity.sub !== expect.subject.sub) {
      return refuse("routines_subject", "another account signed in at Perspicax");
    }
    if (!(outcome.grantedScope ?? "").split(" ").includes(ROUTINE_DELEGATION_SCOPE)) {
      return refuse("routines_scope", "Perspicax did not grant the routine delegation scope");
    }
    if (!deps.grants.sessionPrincipal || deps.grants.sessionPrincipal(expect.sessionId) !== expect.principalId) {
      return refuse("routines_session", "the session that started the delegation is gone");
    }
    const orgRole = orgRoleForRole(identity.role);
    if (!scopesForRole(identity.role) || !orgRole) return refuse("role", `subject ${identity.sub.slice(0, 64)} has no person role`);
    if (!refreshToken) return refuse("grant", "the identity provider returned no refresh token");
    const unavailable = deps.grants.unavailableReason();
    if (unavailable || !deps.grants.createRoutineDelegation) return refuse("unavailable", unavailable ?? "routine delegations are not kept on this server");
    deps.forSubject({
      iss: identity.iss,
      sub: identity.sub,
      claims: { email: identity.email, name: identity.name, login: identity.preferredUsername, ...(identity.avatar ? { avatar: identity.avatar } : {}) },
      orgRole,
      ...(identity.teams ? { teams: identity.teams } : {}),
      ...(identity.role === "admin" || identity.role === "manager" || identity.role === "employee" ? { perspicaxRole: identity.role } : {}),
    });
    try {
      deps.grants.createRoutineDelegation({
        principalId: expect.principalId,
        iss: identity.iss,
        sub: identity.sub,
        refreshToken,
        ...(outcome.grant.accessToken && outcome.grant.accessExpiresAt !== undefined
          ? { accessToken: outcome.grant.accessToken, accessExpiresAt: outcome.grant.accessExpiresAt }
          : {}),
      });
    } catch (error) {
      return refuse("unavailable", error instanceof Error ? error.message : String(error));
    }
    redirect(res, routineDelegationReturn({ ok: true }), [clearBinding]);
  };

  const reauthReturn = (client: AccountReauthClient | OidcClientKind | undefined, outcome: { ok: true } | { error: string }) =>
    client === "phone" ? phoneReauthReturn(origin, outcome) : webReauthReturn(outcome);

  /** 2026-10-18: the person signed in again for their account deletion. Same
   * subject, same live session, a recent auth_time (checked by the relying
   * party), an access token; any refusal revokes what the provider gave. */
  const reauthCallback = (res: ServerResponse, outcome: Extract<Awaited<ReturnType<OidcRelyingParty["callback"]>>, { ok: true }>): void => {
    const identity = outcome.identity;
    const refreshToken = outcome.grant.refreshToken;
    const expect = outcome.expect;
    const client = outcome.client;
    const refuse = (code: string, why: string) => {
      log(`oidc sign-in again refused (${code}): ${why}`);
      // Its refresh token when Perspicax gave one (ends its access token
      // too), else the access token itself: nothing of it stays live.
      const accessToken = outcome.grant.accessToken;
      if (refreshToken) revocations.enqueue(refreshToken, "refresh_token", `a refused sign-in again (${code})`);
      else if (accessToken) revocations.enqueue(accessToken, "access_token", `a refused sign-in again (${code})`);
      redirect(res, reauthReturn(client, { error: code }), [clearBinding]);
    };
    if (!expect) return refuse("reauth_session", "the flow did not remember who started it");
    if (identity.iss !== expect.subject.iss || identity.sub !== expect.subject.sub) {
      return refuse("reauth_subject", "another account signed in at Perspicax");
    }
    if (!deps.grants.sessionPrincipal || deps.grants.sessionPrincipal(expect.sessionId) !== expect.principalId) {
      return refuse("reauth_session", "the session that asked is gone");
    }
    // Perspicax dates only a sign-in that kept the marker (it drops it for
    // another account, or an older Perspicax that does not know it).
    if (!(outcome.grantedScope ?? "").split(" ").includes(ACCOUNT_ERASURE_SCOPE)) {
      return refuse("reauth_scope", "Perspicax did not grant the account erasure scope");
    }
    const accessToken = outcome.grant.accessToken;
    if (!accessToken) return refuse("grant", "the identity provider returned no access token");
    if (!deps.reauth) return refuse("unavailable", "this server keeps no sign-in for account deletion");
    const kept = deps.reauth.keep({ expect, accessToken, ...(refreshToken ? { refreshToken } : {}), authTimeSeconds: identity.authTime });
    if (!kept) return refuse("reauth_stale", "the sign-in is not recent");
    redirect(res, reauthReturn(client, { ok: true }), [clearBinding]);
  };

  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    const path = url.pathname;
    if (path === OIDC_BACKCHANNEL_LOGOUT_PATH) {
      if (req.method !== "POST") {
        req.resume();
        jsonAnswer(res, 405, { error: "method_not_allowed" }, { allow: "POST" });
        return true;
      }
      await backchannel(req, res);
      return true;
    }
    if (path === ACCOUNT_REAUTH_PATH) {
      if (req.method !== "GET") {
        res.writeHead(405, { allow: "GET", "content-type": "application/json" });
        res.end(JSON.stringify({ error: "method_not_allowed" }));
        return true;
      }
      const taken = deps.reauth?.takeTicket(url.searchParams.get("ticket"));
      if (!taken) {
        log("oidc sign-in again refused: an unknown, used or expired ticket");
        // Which app asked is unknown without the ticket: the phone names it.
        redirect(res, reauthReturn(url.searchParams.get("client") === "phone" ? "phone" : "web", { error: "reauth_ticket" }), []);
        return true;
      }
      let started;
      try {
        started = await rp.start({ purpose: "reauth", client: taken.client, principalId: taken.expect.principalId, subject: taken.expect.subject, sessionId: taken.expect.sessionId });
      } catch (error) {
        log(`oidc sign-in again could not start: ${error instanceof Error ? error.message : String(error)}`);
        redirect(res, reauthReturn(taken.client, { error: "unavailable" }), []);
        return true;
      }
      redirect(res, started.authorizationUrl, [oidcBindingCookie(deps.sessionCookie, deps.config.redirectUri, started.binding)]);
      return true;
    }
    if (path !== OIDC_START_PATH && path !== OIDC_CALLBACK_PATH) return false;
    if (req.method !== "GET") {
      res.writeHead(405, { allow: "GET", "content-type": "application/json" });
      res.end(JSON.stringify({ error: "method_not_allowed" }));
      return true;
    }
    if (path === OIDC_START_PATH) {
      const client = parseClient(url.searchParams.get("client"));
      if (!client) {
        fail(res, "client");
        return true;
      }
      // A loopback return is the desktop app's only: anything else, or an
      // address that is not exactly a loopback listener, ends on /pair
      // (never on the address it named).
      // A phone names only its app's scheme (`return=sagax`).
      const rawReturn = url.searchParams.get("return");
      const returnTo = rawReturn === null ? undefined
        : client === "phone" ? (rawReturn === PHONE_SAGAX_RETURN ? rawReturn : null)
        : rawReturn === sagaxReturnLink(origin) ? rawReturn : validLoopbackReturn(rawReturn) ?? null;
      if (returnTo === null || (returnTo && client !== "desktop" && client !== "phone")) {
        log("oidc sign-in refused: a return address that is not this desktop's loopback listener");
        fail(res, "return");
        return true;
      }
      const unavailable = deps.grants.unavailableReason();
      if (unavailable) {
        log(`oidc sign-in could not start: ${unavailable}`);
        fail(res, "unavailable", [], client, returnTo);
        return true;
      }
      // "Sign in again" (`fresh=1`): Perspicax asks for the factors even
      // with a session there (`prompt=login`, `max_age=0`).
      const fresh = url.searchParams.get("fresh") === "1";
      let started;
      try {
        started = await rp.start({ client, ...(returnTo ? { returnTo } : {}), ...(fresh ? { fresh } : {}) });
      } catch (error) {
        log(`oidc sign-in could not start: ${error instanceof Error ? error.message : String(error)}`);
        fail(res, "unavailable", [], client, returnTo);
        return true;
      }
      redirect(res, started.authorizationUrl, [oidcBindingCookie(deps.sessionCookie, deps.config.redirectUri, started.binding)]);
      return true;
    }
    const binding = parseCookies(req.headers.cookie).get(bindingCookie);
    const outcome = await rp.callback(url.searchParams, binding);
    if (!outcome.ok) {
      log(`oidc ${outcome.purpose === "routines" ? "routine delegation" : outcome.purpose === "reauth" ? "sign-in again" : "sign-in"} refused (${outcome.code}): ${outcome.error}`);
      if (outcome.purpose === "routines") redirect(res, routineDelegationReturn({ error: outcome.code }), [clearBinding]);
      else if (outcome.purpose === "reauth") redirect(res, reauthReturn(outcome.client, { error: outcome.code }), [clearBinding]);
      else fail(res, outcome.code, [clearBinding], outcome.client, outcome.returnTo);
      return true;
    }
    if (outcome.purpose === "routines") {
      delegationCallback(res, outcome);
      return true;
    }
    if (outcome.purpose === "reauth") {
      reauthCallback(res, outcome);
      return true;
    }
    const identity: OidcIdentity = outcome.identity;
    const client = outcome.client;
    const returnTo = outcome.returnTo;
    const refreshToken = outcome.grant.refreshToken;
    const refuse = (code: string, why: string) => {
      log(`oidc sign-in refused (${code}): ${why}`);
      if (refreshToken) revocations.enqueue(refreshToken, "refresh_token", `a refused sign-in (${code})`);
      fail(res, code, [clearBinding], client, returnTo);
    };
    const scopes = scopesForRole(identity.role);
    const orgRole = orgRoleForRole(identity.role);
    if (!scopes || !orgRole) {
      refuse("role", `subject ${identity.sub.slice(0, 64)} has no person role`);
      return true;
    }
    // Never a session without its grant: the grant is how the provider ends it.
    if (!refreshToken) {
      refuse("grant", "the identity provider returned no refresh token (is offline_access allowed for this client?)");
      return true;
    }
    const unavailable = deps.grants.unavailableReason();
    if (unavailable) {
      refuse("unavailable", unavailable);
      return true;
    }
    const principal = deps.forSubject({
      iss: identity.iss,
      sub: identity.sub,
      claims: { email: identity.email, name: identity.name, login: identity.preferredUsername, ...(identity.avatar ? { avatar: identity.avatar } : {}) },
      orgRole,
      ...(identity.teams ? { teams: identity.teams } : {}),
      ...(identity.role === "admin" || identity.role === "manager" || identity.role === "employee" ? { perspicaxRole: identity.role } : {}),
    });
    const native = client === "desktop" || client === "phone";
    let grantRef: string;
    try {
      grantRef = deps.grants.createGrant({
        iss: identity.iss,
        sub: identity.sub,
        refreshToken,
        ...(outcome.grant.accessToken && outcome.grant.accessExpiresAt !== undefined
          ? { accessToken: outcome.grant.accessToken, accessExpiresAt: outcome.grant.accessExpiresAt }
          : {}),
        bindBy: now() + (native ? OIDC_NATIVE_PAIRING_TTL_MS + OIDC_NATIVE_BIND_GRACE_MS : 60_000),
      });
    } catch (error) {
      refuse("unavailable", error instanceof Error ? error.message : String(error));
      return true;
    }
    const idp = { iss: identity.iss, sub: identity.sub, ...(identity.role ? { role: identity.role } : {}), grantRef };
    // The provider's own word on when the person proved their factors, from
    // the verified id_token, and only when recent: a silent single sign-on
    // or an old sign-in gives a valid session that is not recent (a pairing
    // code a bot made never is either; server/recent-sign-in.ts).
    const authAt = authAtFromAuthTime(identity.authTime, now());
    if (authAt === undefined) log(`oidc sign-in: no recent auth_time from the provider; the session is not a recent sign-in`);
    try {
      deps.grants.signedIn?.({
        principalId: principal.id,
        ...(outcome.grant.accessToken && outcome.grant.accessExpiresAt !== undefined
          ? { accessToken: outcome.grant.accessToken, accessExpiresAt: outcome.grant.accessExpiresAt }
          : {}),
      });
    } catch (error) {
      log(`oidc sign-in: the routine delegation could not start: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (native) {
      const pairing = deps.openPairing({
        principalId: principal.id,
        scopes,
        ttlMs: OIDC_NATIVE_PAIRING_TTL_MS,
        label: client === "desktop" ? "Sagax desktop" : "Sagax phone",
        idp,
        ...(authAt !== undefined ? { authAt } : {}),
      });
      redirect(res, client === "desktop"
        ? desktopReturnLink(origin, { code: pairing.credential }, returnTo)
        : phoneReturnLink(origin, pairing.credential, deps.serverName(), returnTo), [clearBinding]);
      return true;
    }
    const userAgent = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined;
    let issued;
    try {
      issued = deps.issueSession({
        label: labelFromUserAgent(userAgent) || "Pulsatrix sign-in",
        scopes,
        ...(principal.email ? { email: principal.email } : {}),
        principalId: principal.id,
        idp,
        ...(authAt !== undefined ? { authAt } : {}),
      });
    } catch (error) {
      deps.grants.discard(grantRef);
      throw error;
    }
    deps.grants.bindSession(grantRef, issued.session.id);
    redirect(res, "/", [
      serializeSessionCookie(deps.sessionCookie, issued.token, { secure, maxAgeSeconds: cookieMaxAgeSeconds(issued.session) }),
      clearBinding,
    ]);
    return true;
  };
}
