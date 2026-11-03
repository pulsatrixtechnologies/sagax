// Presence of the people of an organization server (shared/presence.ts,
// server/people/presence.ts):
//
//   GET  /api/org/presence        every active person of the directory: their
//                                 state and when they were last seen. A
//                                 person who hides their presence reads as
//                                 offline with no time; the caller's own row
//                                 is real and says `hidden`.
//   POST /api/presence/heartbeat  { pageId, kind, idleMs, systemIdle? } from
//                                 an open app, about every minute.
//
// Organization servers only (a solo server has one person: 404). Only a
// person of this organization's directory, signed in: not the loopback, not a
// service account, not a session of another issuer. An admin sees exactly
// what a member sees.
import { z } from "zod";

import { SYSTEM_IDLE_STATES, publicPresence, type PresenceView, type SystemIdleState } from "../../shared/presence.ts";
import type { PresenceHeartbeat } from "../people/presence.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const PRESENCE_PATH = "/api/org/presence";
export const PRESENCE_HEARTBEAT_PATH = "/api/presence/heartbeat";

export type PresenceViewer =
  | { ok: true; id: string; sessionId: string }
  | { ok: false; code: "session_required" | "service_account" | "other_organization" };

export interface PresenceRouteDeps {
  organization(): boolean;
  /** The signed-in person of this organization behind the request, or why not. */
  viewer(auth: RequestAuth): PresenceViewer;
  /** The active people of the directory (no service account, nobody disabled). */
  people(): readonly string[];
  /** The person's real state. */
  view(principalId: string): PresenceView;
  /** The person turned off "Show when I am online". */
  hidden(principalId: string): boolean;
  heartbeat(principalId: string, sessionId: string, beat: PresenceHeartbeat): PresenceView;
}

const heartbeatBody = z.object({
  pageId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  kind: z.enum(["desktop", "web"]),
  idleMs: z.number().int().min(0).max(7 * 24 * 60 * 60_000),
  systemIdle: z.enum(SYSTEM_IDLE_STATES as [SystemIdleState, ...SystemIdleState[]]).optional(),
}).strict();

const refusal = (code: Exclude<PresenceViewer, { ok: true }>["code"]) =>
  code === "session_required"
    ? { status: 401, body: { error: "Sign in with Pulsatrix to see who is here.", code } }
    : { status: 403, body: { error: "Presence is for the people of this organization.", code } };

export function createPresenceRoutes(deps: PresenceRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== PRESENCE_PATH && path !== PRESENCE_HEARTBEAT_PATH) return PASS;
    if (!deps.organization()) return json(res, 404, { error: "Presence needs an organization server.", code: "identity_perspicax" });
    res.setHeader("cache-control", "no-store");
    const viewer = deps.viewer(auth);
    if (!viewer.ok) {
      const refused = refusal(viewer.code);
      return json(res, refused.status, refused.body);
    }
    const self = viewer.id.toLowerCase();
    if (path === PRESENCE_PATH) {
      if (method !== "GET") return json(res, 405, { error: "GET" });
      const people = deps.people().map((id) => {
        const real = deps.view(id);
        if (id.toLowerCase() === self) return { ...real, principalId: id, ...(deps.hidden(id) ? { hidden: true } : {}) };
        return { ...publicPresence(real, deps.hidden(id)), principalId: id };
      });
      return json(res, 200, { people });
    }
    if (method !== "POST") return json(res, 405, { error: "POST" });
    const parsed = heartbeatBody.safeParse(await readBody(req));
    if (!parsed.success) return json(res, 400, { error: "send { pageId, kind: \"desktop\" | \"web\", idleMs, systemIdle? }" });
    const view = deps.heartbeat(viewer.id, viewer.sessionId, { ...parsed.data, systemIdle: parsed.data.systemIdle ?? "unknown" });
    return json(res, 200, { ...view, principalId: viewer.id, ...(deps.hidden(viewer.id) ? { hidden: true } : {}) });
  };
}

/** Whether a `presence.changed` frame reaches this stream: a person of the
 * organization only, and a frame addressed to one person (their own real
 * state) to that person only. */
export function presenceFrameAllowed(payload: { audience?: unknown }, stream: { presence?: boolean; viewerId?: string }): boolean {
  if (!stream.presence || !stream.viewerId) return false;
  if (payload.audience === undefined) return true;
  return typeof payload.audience === "string" && payload.audience.toLowerCase() === stream.viewerId.toLowerCase();
}
