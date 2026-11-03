// POST /api/people-dms { principalId }: open (or create) the direct
// conversation between the signed-in person and another person of the
// organization (server/people/people-dms.ts). Organization servers only; the other
// person must be an active person of the Perspicax directory, never a
// service account and never the caller. Answers the conversation as a
// group record (200 when it already existed, 201 when created).
import { z } from "zod";

import { findPeopleDm, type PeopleDmLike } from "../people/people-dms.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface PeopleDmRouteDeps<G extends PeopleDmLike & { id: string }> {
  organization(): boolean;
  /** The signed-in person's principal id; none for loopback or a session
   * without one. */
  viewerId(auth: RequestAuth): string | undefined;
  /** An active person of the directory by principal id, or why not. */
  person(principalId: string): { ok: true; id: string; name: string } | { ok: false; code: "unknown_person" | "service_account" };
  displayName(principalId: string): string;
  groups(): readonly G[];
  create(input: { a: string; b: string; name: string }): G;
  /** The conversation as the caller sees it. */
  project(group: G, auth?: RequestAuth): unknown;
}

const bodySchema = z.object({ principalId: z.string().min(1).max(200) }).strict();

export function createPeopleDmRoutes<G extends PeopleDmLike & { id: string }>(deps: PeopleDmRouteDeps<G>): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/people-dms" || method !== "POST") return PASS;
    if (!deps.organization()) return json(res, 404, { error: "Direct messages between people need an organization server.", code: "identity_perspicax" });
    const self = deps.viewerId(auth);
    if (!self) return json(res, 403, { error: "Sign in with Pulsatrix to write to someone.", code: "session_required" });
    const parsed = bodySchema.safeParse(await readBody(req));
    if (!parsed.success) return json(res, 400, { error: "send { principalId } of the person to write to" });
    const target = deps.person(parsed.data.principalId);
    if (!target.ok) {
      return json(res, 400, { error: target.code === "service_account" ? "A service account cannot receive messages." : "Choose a person from the organization directory.", code: target.code });
    }
    if (target.id.toLowerCase() === self.toLowerCase()) return json(res, 400, { error: "Choose someone other than yourself.", code: "self" });
    const existing = findPeopleDm(deps.groups(), self, target.id);
    if (existing) return json(res, 200, { group: deps.project(existing, auth), created: false });
    const name = `${deps.displayName(self)}, ${target.name}`;
    const group = deps.create({ a: self, b: target.id, name });
    return json(res, 201, { group: deps.project(group, auth), created: true });
  };
}
