// Pairing routes (#1388 wave 4): companion /api/pair exchange (pre-auth) and
// admin pairing open/list/cancel (post-gate).
//
// Pre-auth:
//   POST /api/pair
//
// Authenticated:
//   POST   /api/auth/pairing
//   GET    /api/auth/pairing
//   DELETE /api/auth/pairing/:id
//
// JSON-only CSRF, lockout via sessions.exchange, live-session check before
// minting a code, and org admin-target refusal stay identical.
import { phonePairingLink } from "../../shared/pairing-link.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { requestOrigin, requestSource } from "../auth/request-auth.ts";
import { labelFromUserAgent } from "../auth/request-auth.ts";
import type { Scope, SessionRecord } from "../auth/sessions.ts";
import { formatPairingCode } from "../auth/sessions.ts";
import {
  PASS,
  type PreAuthRouteHandler,
  type RouteHandler,
} from "./table.ts";

export interface CompanionPairRouteDeps {
  sessions: {
    exchange(input: {
      code: string;
      label: string;
      source: string;
      fallbackLabel?: string;
      attemptId?: string;
    }): { ok: true; token: string; session: { id: string; label: string; createdAt: number; lastSeenAt: number } }
      | { ok: false; status: number; error: string; code?: string };
  };
  serverName(): string;
}

export interface PairingAdminRouteDeps {
  identityKind: () => string;
  sessions: {
    isLive(sessionId: string): boolean;
    openPairing(input: {
      label?: string;
      scopes?: Scope[];
      principalId?: string;
      idp?: SessionRecord["idp"];
    }): { id: string; code: string; credential: string; expiresAt: number };
    openPairings(): Array<{ id: string; scopes: Scope[] }>;
    cancelPairing(id: string): unknown;
  };
  actorPrincipalId(auth: RequestAuth): string;
  publicUrl(): string | null;
  serverName(): string;
  orgAdminCaller(auth: RequestAuth): boolean;
}

/** Companion app pairing shape (iOS/Android). Public like /api/auth/pair. */
export function createCompanionPairRoutes(deps: CompanionPairRouteDeps): PreAuthRouteHandler {
  return async ({ req, res, path, method, json, readBody }) => {
    if (!(method === "POST" && path === "/api/pair")) return PASS;
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
      return json(res, 415, { error: "send the pairing credential as JSON (content-type: application/json)" });
    }
    const body = await readBody(req);
    const credential = typeof body?.credential === "string" ? body.credential : typeof body?.code === "string" ? body.code : "";
    const label = typeof body?.deviceName === "string" ? body.deviceName : "";
    const attemptId = typeof body?.pairRequestId === "string" ? body.pairRequestId : undefined;
    const paired = deps.sessions.exchange({
      code: credential,
      label,
      attemptId,
      source: requestSource(req),
      fallbackLabel: labelFromUserAgent(req.headers["user-agent"]),
    });
    if (!paired.ok) {
      console.warn(`pairing refused from ${requestSource(req)}: ${paired.error}`);
      return json(res, paired.status, { error: paired.error, ...(paired.code ? { code: paired.code } : {}) });
    }
    return json(res, 200, {
      token: paired.token,
      device: {
        id: paired.session.id,
        name: paired.session.label,
        createdAt: paired.session.createdAt,
        lastSeenAt: paired.session.lastSeenAt,
      },
      serverName: deps.serverName(),
    });
  };
}

/** Open, list and cancel pairing codes (admin / org rules). */
export function createPairingAdminRoutes(deps: PairingAdminRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (method === "POST" && path === "/api/auth/pairing") {
      const body = await readBody(req);
      // Authentication happened before the request body was read. A session
      // can be revoked while a slow client is still sending that body, so do
      // not let the captured authorization mint a replacement session.
      if (auth.kind === "session" && !deps.sessions.isLive(auth.session.id)) {
        return json(res, 401, { error: "Your session ended. Sign in again before creating a pairing code." });
      }
      const requested: unknown = body?.scopes;
      let scopes = Array.isArray(requested) ? requested.filter((v): v is Scope => v === "admin" || v === "client") : undefined;
      let principalId: string | undefined;
      if (deps.identityKind() === "perspicax" && auth.kind === "session") {
        principalId = deps.actorPrincipalId(auth) || undefined;
        if (!principalId) return json(res, 403, { error: "Only a signed-in person can pair a device on this server.", code: "principal_required" });
        const own = auth.scopes;
        scopes = (scopes?.length ? scopes : [...own]).filter((scope) => own.includes(scope));
        if (!scopes.length) return json(res, 403, { error: "You cannot give a device more access than you have.", code: "scope_exceeds_session" });
      } else {
        const carriesPrincipal = (scopes?.length ? scopes : ["admin"]).includes("admin");
        principalId = carriesPrincipal ? deps.actorPrincipalId(auth) || undefined : undefined;
      }
      const creatorIdp = auth.kind === "session" && principalId ? auth.session.idp : undefined;
      let opened: ReturnType<typeof deps.sessions.openPairing>;
      try {
        opened = deps.sessions.openPairing({
          label: typeof body?.label === "string" ? body.label : undefined,
          scopes,
          principalId,
          ...(creatorIdp ? { idp: { iss: creatorIdp.iss, sub: creatorIdp.sub } } : {}),
        });
      } catch (error) {
        if ((error as { code?: unknown }).code === "cloud_personal") {
          return json(res, 403, { error: (error as Error).message, code: "cloud_personal" });
        }
        throw error;
      }
      const origin = requestOrigin(req);
      const base = deps.publicUrl() ?? (auth.kind === "session" && origin ? origin : null);
      const code = formatPairingCode(opened.code);
      const serverName = deps.serverName();
      const invite = base ? phonePairingLink({ address: base, token: opened.credential, name: serverName }) : null;
      return json(res, 200, {
        id: opened.id,
        code,
        credential: opened.credential,
        expiresAt: opened.expiresAt,
        url: base ? `${base}/pair#code=${code}` : null,
        inviteUrl: invite,
        serverName,
        hint: base
          ? null
          : "this server has no public address to put in a link: set SAGAX_PUBLIC_URL, or open /pair on the address you use and type the code",
      });
    }
    if (method === "GET" && path === "/api/auth/pairing") {
      return json(res, 200, { pairings: deps.sessions.openPairings(), publicUrl: deps.publicUrl() });
    }
    const m = path.match(/^\/api\/auth\/pairing\/([\w-]+)$/);
    if (m && method === "DELETE") {
      if (deps.identityKind() === "perspicax" && !deps.orgAdminCaller(auth) && deps.sessions.openPairings().some((pairing) => pairing.id === m[1] && pairing.scopes.includes("admin"))) {
        return json(res, 403, { error: "Only an organization admin can cancel an admin's pairing code.", code: "target_is_admin" });
      }
      const cancelled = deps.sessions.cancelPairing(m[1]);
      return json(res, cancelled ? 200 : 404, cancelled ? { ok: true } : { error: "no such pairing code" });
    }
    return PASS;
  };
}
