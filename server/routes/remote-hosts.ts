// Computers panel (team canvas, 2026-11-06): the person's own enrolled
// unattended hosts with their online state and team, a one-time install
// code to add a computer ("Unattended Remote Control"), and placing a host
// on a team. Person isolation: only the caller's own hosts, on the caller's
// own teams. No admin gate (decision of 2026-10-26).
import { z } from "zod";

import { PASS, type RouteHandler } from "./table.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import type { HostCodeOutcome } from "../remote-support/remote-unattended-hosts.ts";
import type { RemoteHostTeams } from "../remote-support/remote-host-teams.ts";
import {
  UNATTENDED_HOST_SCOPES,
  unattendedHostOnline,
  type RemoteHostCard,
  type UnattendedHostRow,
} from "../../shared/remote-unattended-host.ts";

const LIST = "/api/remote-hosts";
const CODE = "/api/remote-hosts/code";
const TEAM = /^\/api\/remote-hosts\/(h_[0-9a-f]{32})\/team$/;

const codeBody = z.object({
  scope: z.enum(UNATTENDED_HOST_SCOPES).optional(),
  consentRef: z.string().max(128).optional(),
}).strict();
const teamBody = z.object({ section: z.string().trim().max(60).nullable() }).strict();

export function createRemoteHostsRoutes(deps: {
  principalId(auth: RequestAuth): string | undefined;
  /** The person's own enrolled hosts (not revoked). */
  available(principalId: string): Promise<{ available: boolean; hosts: UnattendedHostRow[]; reason?: string }>;
  installCode(principalId: string, options: { scope?: string; consentRef?: string }): Promise<HostCodeOutcome>;
  teams: Pick<RemoteHostTeams, "forPrincipal" | "assign">;
  /** The caller's own team names. */
  sectionsFor(auth: RequestAuth): string[];
  resolveSectionId?(section: string, auth: RequestAuth): string | undefined;
  now?: () => number;
}): RouteHandler {
  const now = deps.now ?? (() => Date.now());
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const team = TEAM.exec(path);
    if (path !== LIST && path !== CODE && !team) return PASS;
    const principalId = deps.principalId(auth);
    if (!principalId) return json(res, 401, { error: "Sign in to manage your computers." });

    if (path === LIST) {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      const listed = await deps.available(principalId);
      const placed = deps.teams.forPrincipal(principalId);
      const at = now();
      const hosts: RemoteHostCard[] = listed.hosts.map((row) => ({
        hostId: row.hostId,
        hostname: row.hostname,
        org: row.org,
        scope: row.scope,
        state: row.state,
        enrolledAt: row.enrolledAt,
        expiresAt: row.expiresAt,
        lastSeenAt: row.lastSeenAt,
        online: unattendedHostOnline(row, at),
        section: placed.get(row.hostId)?.section ?? null,
      }));
      return json(res, 200, { available: listed.available, hosts, ...(listed.reason ? { reason: listed.reason } : {}) });
    }

    if (path === CODE) {
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      const parsed = codeBody.safeParse(await readBody(req) ?? {});
      if (!parsed.success) return json(res, 400, { error: "Send scope and consentRef, or nothing." });
      const out = await deps.installCode(principalId, parsed.data);
      if (!out.ok) return json(res, out.error === "unavailable" ? 409 : 502, { error: out.message, code: out.error });
      const { ok: _ok, ...body } = out;
      return json(res, 200, body);
    }

    if (method !== "PUT") return json(res, 405, { error: "method not allowed" });
    const hostId = team![1]!;
    const parsed = teamBody.safeParse(await readBody(req));
    if (!parsed.success) return json(res, 400, { error: "Send section (a team name) or null." });
    const section = parsed.data.section || null;
    if (section !== null) {
      if (!deps.sectionsFor(auth).includes(section)) return json(res, 404, { error: "Create the team before placing a computer on it." });
      const listed = await deps.available(principalId);
      if (!listed.available) return json(res, 409, { error: listed.reason ?? "Enrolled computers are not available.", code: "unavailable" });
      if (!listed.hosts.some((row) => row.hostId === hostId && row.state === "enrolled")) {
        return json(res, 404, { error: "That computer is not one of your enrolled hosts.", code: "not_found" });
      }
    }
    deps.teams.assign(principalId, hostId, section, section === null ? null : deps.resolveSectionId?.(section, auth));
    return json(res, 200, { ok: true, section });
  };
}
