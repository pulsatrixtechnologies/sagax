// Auth HTTP routes (#1388 wave 4): public email/pair exchange and post-gate
// session, stream-ticket, logout and session list/revoke.
//
// Pre-auth (PRE_AUTH_ROUTES):
//   POST /api/auth/email/start
//   POST /api/auth/email/verify
//   POST /api/auth/pair
//
// Authenticated (ROUTES):
//   GET  /api/auth/session
//   POST /api/auth/stream-ticket
//   POST /api/auth/logout
//   GET  /api/auth/sessions
//   DELETE /api/auth/sessions/:id
//
// JSON-only CSRF (content-type), per-source lockout, cookie issue/clear and
// org admin target checks stay identical to the former index.ts bodies.
import type { ProfileManagement } from "../auth/oidc-login.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { labelFromUserAgent, parseCookies, requestOrigin, requestSource } from "../auth/request-auth.ts";
import type { PublicSession, Scope, SessionRecord } from "../auth/sessions.ts";
import {
  PASS,
  type PreAuthRouteHandler,
  type RouteHandler,
} from "./table.ts";

export interface AuthPublicRouteDeps {
  emailSignIn: {
    enabled(): boolean;
    start(email: string, source: string): Promise<{ ok: true } | { ok: false; status: number; error: string }>;
    verify(email: string, code: string): Promise<
      | { ok: true; email: string; userId: string; scopes: Scope[] }
      | { ok: false; status: number; error: string }
    >;
  };
  sessions: {
    attemptAllowed(source: string): { ok: true } | { ok: false; retryAfterMs: number };
    noteFailure(source: string): void;
    clearFailures(source: string): void;
    issue(input: {
      label: string;
      scopes: Scope[];
      userId?: string;
      email?: string;
      principalId?: string;
    }): { token: string; session: PublicSession };
    exchange(input: {
      code: string;
      label: string;
      source: string;
      fallbackLabel?: string;
      attemptId?: string;
      browser?: boolean;
    }): { ok: true; token: string; session: PublicSession } | { ok: false; status: number; error: string; code?: string };
    previewBrowserSignIn(code: string): unknown | null;
    previewSignInPrincipal(code: string): { expiresAt: number; principalId: string } | null;
    authenticate(token: string | undefined): SessionRecord | null;
    revoke(id: string): unknown;
  };
  isAccountEmail(email: string): boolean;
  acceptOpenInvitesForEmail(email: string): boolean;
  persistOrgState(): void;
  principalsForAccount(input: { email: string; controlPlaneUserId?: string }): { id: string };
  sessionPersonFields(principalId: string | undefined): Record<string, unknown>;
  environmentForEmailSignIn(): unknown;
  environmentForPair(): unknown;
  sessionCookieName: string;
  serializeSessionCookie(name: string, token: string, opts: { secure: boolean; maxAgeSeconds: number }): string;
  cookieMaxAgeSeconds(session: { expiresAt: number }): number;
}

export interface AuthSessionRouteDeps {
  environmentId: string;
  hostedWorkspace: boolean;
  identityKind: () => string;
  sessions: {
    issueStreamTicket(sessionId: string): unknown;
    revoke(id: string): unknown;
    list(): PublicSession[];
    byId(id: string): SessionRecord | null | undefined;
  };
  clearSessionCookie(name: string): string;
  sessionCookieName: string;
  computerOwnerFields(): Record<string, unknown>;
  ownerSessionFields(): Record<string, unknown>;
  oidcSessionFields(session: SessionRecord): Record<string, unknown>;
  profileManagedFor(auth: RequestAuth): boolean;
  profileManagement: ProfileManagement | null;
  sessionPersonFields(principalId: string | undefined): Record<string, unknown>;
  viewerIsOperator(auth: RequestAuth): boolean;
  orgAdminCaller(auth: RequestAuth): boolean;
  mayActOnPerson(auth: RequestAuth, principalId: string): boolean;
}

/** Public email sign-in and /api/auth/pair (JSON-only, lockout, cookie). */
export function createAuthPublicRoutes(deps: AuthPublicRouteDeps): PreAuthRouteHandler {
  return async ({ req, res, path, method, json, readBody }) => {
    if (method === "POST" && (path === "/api/auth/email/start" || path === "/api/auth/email/verify")) {
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
        return json(res, 415, { error: "send the sign-in request as JSON (content-type: application/json)" });
      }
      if (!deps.emailSignIn.enabled()) return json(res, 404, { error: "email sign-in is not set up on this server; use a pairing code" });
      const source = requestSource(req);
      const allowed = deps.sessions.attemptAllowed(source);
      if (!allowed.ok) return json(res, 429, { error: `too many failed sign-in attempts from your address; try again in ${Math.ceil(allowed.retryAfterMs / 1000)}s` });
      const body = await readBody(req);
      const email = typeof body?.email === "string" ? body.email : "";
      if (path === "/api/auth/email/start") {
        const started = await deps.emailSignIn.start(email, source);
        if (!started.ok) {
          if (started.status === 403) deps.sessions.noteFailure(source);
          return json(res, started.status, { error: started.error });
        }
        return json(res, 200, { ok: true });
      }
      const code = typeof body?.code === "string" ? body.code : "";
      const label = typeof body?.label === "string" ? body.label : "";
      const verified = await deps.emailSignIn.verify(email, code);
      if (!verified.ok) {
        if (verified.status === 401 || verified.status === 403) deps.sessions.noteFailure(source);
        console.warn(`email sign-in refused from ${source}: ${verified.error}`);
        return json(res, verified.status, { error: verified.error });
      }
      deps.sessions.clearFailures(source);
      if (!deps.isAccountEmail(verified.email)) return json(res, 400, { error: "this address cannot sign in: at most 320 characters, shaped name@domain" });
      if (deps.acceptOpenInvitesForEmail(verified.email)) {
        try {
          deps.persistOrgState();
        } catch (error) {
          console.warn(`accepting the invite for ${verified.email} could not be saved: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const principal = deps.principalsForAccount({ email: verified.email, controlPlaneUserId: verified.userId || undefined });
      const issued = deps.sessions.issue({
        label: label.trim() || labelFromUserAgent(req.headers["user-agent"]),
        scopes: verified.scopes,
        userId: verified.userId,
        email: verified.email,
        principalId: principal.id,
      });
      const secure = requestOrigin(req)?.startsWith("https://") === true;
      res.setHeader("set-cookie", deps.serializeSessionCookie(deps.sessionCookieName, issued.token, {
        secure,
        maxAgeSeconds: deps.cookieMaxAgeSeconds(issued.session),
      }));
      return json(res, 200, { session: issued.session, environment: deps.environmentForEmailSignIn() });
    }

    if (method === "POST" && path === "/api/auth/pair") {
      // JSON only: a cross-site HTML form cannot send this content type
      // without a preflight, so a stray unused code cannot be planted as a
      // session in someone else's browser.
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
        return json(res, 415, { error: "send the pairing code as JSON (content-type: application/json)" });
      }
      const body = await readBody(req);
      const code = typeof body?.code === "string" ? body.code : "";
      const wantsCookie = body?.cookie === true;
      const label = typeof body?.label === "string" ? body.label : "";
      const attemptId = typeof body?.attemptId === "string" ? body.attemptId : undefined;
      const browser = body?.browser === true;
      if (body?.preview === true) {
        if (browser) {
          const preview = deps.sessions.previewBrowserSignIn(code);
          return preview ? json(res, 200, preview) : json(res, 401, { error: "this sign-in link has expired or was already used" });
        }
        const peek = deps.sessions.previewSignInPrincipal(code);
        if (!peek) return json(res, 401, { error: "this sign-in link has expired or was already used" });
        return json(res, 200, { expiresAt: peek.expiresAt, ...deps.sessionPersonFields(peek.principalId) });
      }
      if (browser && !wantsCookie) return json(res, 400, { error: "a browser sign-in sets this browser's cookie; send cookie: true" });
      const result = deps.sessions.exchange({
        code,
        label,
        attemptId,
        browser,
        source: requestSource(req),
        fallbackLabel: labelFromUserAgent(req.headers["user-agent"]),
      });
      if (!result.ok) {
        console.warn(`pairing refused from ${requestSource(req)}: ${result.error}`);
        return json(res, result.status, { error: result.error, ...(result.code ? { code: result.code } : {}) });
      }
      const environment = deps.environmentForPair();
      if (wantsCookie) {
        const previous = browser ? deps.sessions.authenticate(parseCookies(req.headers.cookie).get(deps.sessionCookieName)) : null;
        if (previous && previous.id !== result.session.id) deps.sessions.revoke(previous.id);
        const secure = requestOrigin(req)?.startsWith("https://") === true;
        res.setHeader("set-cookie", deps.serializeSessionCookie(deps.sessionCookieName, result.token, {
          secure,
          maxAgeSeconds: deps.cookieMaxAgeSeconds(result.session),
        }));
        return json(res, 200, { session: result.session, environment });
      }
      return json(res, 200, { token: result.token, session: result.session, environment });
    }

    return PASS;
  };
}

/** Post-gate session identity, tickets, logout and device list. */
export function createAuthSessionRoutes(deps: AuthSessionRouteDeps): RouteHandler {
  return async ({ res, path, method, auth, json }) => {
    if (method === "GET" && path === "/api/auth/session") {
      return json(
        res,
        200,
        auth.kind === "loopback"
          ? {
              kind: "loopback",
              scopes: auth.scopes,
              environmentId: deps.environmentId,
              ...(auth.trust ? { trust: auth.trust } : { ...deps.computerOwnerFields(), ...deps.ownerSessionFields() }),
            }
          : {
              kind: "session",
              id: auth.session.id,
              label: auth.session.label,
              scopes: auth.scopes,
              expiresAt: auth.session.expiresAt,
              via: auth.via,
              environmentId: deps.environmentId,
              ...(auth.session.email ? { email: auth.session.email } : {}),
              ...(auth.session.owner ? { owner: auth.session.owner } : {}),
              ...(deps.hostedWorkspace ? { hosted: true } : {}),
              ...deps.oidcSessionFields(auth.session),
              ...(deps.profileManagedFor(auth) && deps.profileManagement ? deps.profileManagement : {}),
              ...deps.sessionPersonFields(auth.session.principalId),
              ...(deps.identityKind() === "solo" && !auth.session.idp && deps.viewerIsOperator(auth)
                ? { ...deps.computerOwnerFields(), ...deps.ownerSessionFields() }
                : {}),
            },
      );
    }
    if (method === "POST" && path === "/api/auth/stream-ticket") {
      if (auth.kind === "loopback") return json(res, 200, { ticket: null, reason: "loopback needs no ticket" });
      return json(res, 200, deps.sessions.issueStreamTicket(auth.session.id));
    }
    if (method === "POST" && path === "/api/auth/logout") {
      if (auth.kind === "session") deps.sessions.revoke(auth.session.id);
      res.setHeader("set-cookie", deps.clearSessionCookie(deps.sessionCookieName));
      return json(res, 200, { ok: true });
    }
    if (method === "GET" && path === "/api/auth/sessions") {
      return json(res, 200, {
        sessions: deps.sessions.list(),
        current: auth.kind === "session" ? auth.session.id : null,
      });
    }
    const m = path.match(/^\/api\/auth\/sessions\/([\w-]+)$/);
    if (m && method === "DELETE") {
      if (deps.identityKind() === "perspicax" && !deps.orgAdminCaller(auth) && !(auth.kind === "session" && auth.session.id === m[1])) {
        const target = deps.sessions.byId(m[1]);
        if (target && (target.scopes.includes("admin") || !deps.mayActOnPerson(auth, target.principalId ?? ""))) {
          return json(res, 403, { error: "Only an organization admin can end an admin's session.", code: "target_is_admin" });
        }
      }
      const revoked = deps.sessions.revoke(m[1]);
      if (auth.kind === "session" && auth.session.id === m[1]) {
        res.setHeader("set-cookie", deps.clearSessionCookie(deps.sessionCookieName));
      }
      return json(res, revoked ? 200 : 404, revoked ? { ok: true } : { error: "no such session" });
    }
    return PASS;
  };
}
