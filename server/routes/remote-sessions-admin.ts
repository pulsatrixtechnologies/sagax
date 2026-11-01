// The admin "Remote Sessions" page routes. Admin-scoped (/api/admin/...), so
// the tool policy marks them defaultEnabled false: an agent tool never reaches
// them without an explicit grant. A signed-in person reaches them from the
// account menu; the aggregator then enforces who may see each session (a
// workspace admin sees the organization's sessions, anyone else only their
// own), who may record unattended consent (any signed-in person for a host of
// their own, recorded under their principal) and who may revoke it (the
// person who recorded it, or an admin). The enrolled hosts (/hosts) are
// Perspicax's: any person here lists them, opens one, and revokes the ones
// Perspicax lets them (their own, or any as an admin). Unattended access is
// always enabled (2026-11-01). No tunnel address, key or secret ever enters
// a request or an answer.
import { z } from "zod";

import { PASS } from "./table.ts";
import type { RouteHandler } from "./table.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { AdminViewer, RemoteSessionsAdmin } from "../remote-sessions-admin.ts";
import { cleanReason, REVOKE_REASON_MAX, type UnattendedHosts } from "../remote-unattended-hosts.ts";

const LIST = /^\/api\/admin\/remote-sessions$/;
const UNATTENDED = /^\/api\/admin\/remote-sessions\/unattended$/;
const UNATTENDED_REVOKE = /^\/api\/admin\/remote-sessions\/unattended\/revoke$/;
const ONE = /^\/api\/admin\/remote-sessions\/([a-f0-9]{12})\/(logs|end)$/;
// Enrolled hosts (docs/inscription-hote.md): list, open unattended, revoke.
const HOSTS = /^\/api\/admin\/remote-sessions\/hosts$/;
const HOST_ACTION = /^\/api\/admin\/remote-sessions\/hosts\/(h_[0-9a-f]{32})\/(open|revoke)$/;

const grantBody = z.object({
  host_key: z.string().min(1).max(200),
  host_label: z.string().max(200).optional(),
  org: z.string().min(1).max(200),
  /** Accepted for older clients and ignored: the consent is recorded under
   * the signed-in caller's principal. */
  installed_by: z.string().max(200).optional(),
  scope: z.string().max(400).optional(),
  expires_at: z.string().max(40).optional(),
  banner_visible: z.boolean().optional(),
  tray_visible: z.boolean().optional(),
  signed: z.boolean().optional(),
  key_bound: z.boolean().optional(),
}).strict();

const revokeBody = z.object({ host_key: z.string().min(1).max(200), reason: z.string().max(REVOKE_REASON_MAX).optional() }).strict();

const hostRevokeBody = z.object({ reason: z.string().max(REVOKE_REASON_MAX).optional() }).strict();

const hostOpenBody = z.object({
  scope: z.enum(["full-control", "view-only", "shell-only"]).optional(),
  rights: z.enum(["standard", "elevated"]).optional(),
}).strict();

function boolParam(value: string | null): boolean {
  return value === "1" || value === "true";
}

export function createRemoteSessionsAdminRoutes(deps: {
  admin: RemoteSessionsAdmin;
  principalId(auth: RequestAuth): string | undefined;
  orgAdmin(auth: RequestAuth): boolean;
  /** Enrolled hosts at Perspicax. Absent: the hosts routes answer 404. */
  hosts?: UnattendedHosts;
}): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (!path.startsWith("/api/admin/remote-sessions")) return PASS;
    const principalId = deps.principalId(auth);
    if (!principalId) return json(res, 401, { error: "Sign in to see remote sessions." });
    const viewer: AdminViewer = { principalId, orgAdmin: deps.orgAdmin(auth) };

    if (LIST.test(path)) {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      const query = new URL(req.url ?? "", "http://localhost").searchParams;
      const sessions = deps.admin.list(viewer, {
        activeOnly: boolParam(query.get("active")),
        unattendedOnly: boolParam(query.get("unattended")),
        ...(query.get("bot") ? { botId: query.get("bot")! } : {}),
        ...(query.get("host") ? { host: query.get("host")! } : {}),
        ...(query.get("q") ? { search: query.get("q")! } : {}),
      });
      return json(res, 200, { sessions, admin: viewer.orgAdmin });
    }

    if (HOSTS.test(path) && deps.hosts) {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      const listed = await deps.hosts.list({ principalId });
      return json(res, 200, listed);
    }

    const hostAction = HOST_ACTION.exec(path);
    if (hostAction && deps.hosts) {
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      const hostId = hostAction[1]!;
      if (hostAction[2] === "open") {
        // Any person who reaches this server may open (no admin approval,
        // decision 2026-10-26). Unattended access is always on (2026-11-01).
        const parsed = hostOpenBody.safeParse(await readBody(req));
        if (!parsed.success) return json(res, 400, { error: "Send scope (full-control, view-only, shell-only) and rights (standard, elevated), or nothing." });
        const out = await deps.hosts.open({ principalId }, hostId, parsed.data);
        if (out.ok) return json(res, 200, { code: out.code, botId: out.botId, threadId: out.threadId });
        // Ownership refusal reads as not found (person isolation), not a Perspicax fault.
        const status = out.error === "invalid" ? 400 : out.error === "unavailable" ? 409 : out.error === "not_found" ? 404 : 502;
        return json(res, status, { error: out.message, code: out.error });
      }
      // Perspicax decides who may: the person who enrolled the host, or an admin.
      const revokeParsed = hostRevokeBody.safeParse(await readBody(req));
      if (!revokeParsed.success) return json(res, 400, { error: `Send reason (at most ${REVOKE_REASON_MAX} characters), or nothing.` });
      const out = await deps.hosts.revoke({ principalId }, hostId, revokeParsed.data.reason ?? "");
      if (out.ok) return json(res, 200, { ok: true });
      const status = out.error === "invalid" ? 400 : out.error === "unavailable" ? 409 : 502;
      return json(res, status, { error: out.message, code: out.error });
    }

    if (UNATTENDED.test(path)) {
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      const parsed = grantBody.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "Send host_key and org. Consent is never silent." });
      const granted = deps.admin.grantUnattended(viewer, {
        hostKey: parsed.data.host_key,
        hostLabel: parsed.data.host_label,
        org: parsed.data.org,
        scope: parsed.data.scope,
        expiresAt: parsed.data.expires_at,
        bannerVisible: parsed.data.banner_visible,
        trayVisible: parsed.data.tray_visible,
        signed: parsed.data.signed,
        keyBound: parsed.data.key_bound,
      });
      if (granted === "forbidden") return json(res, 403, { error: "That host belongs to another person. Ask a workspace admin." });
      if (!granted) return json(res, 400, { error: "That consent is incomplete (host or org missing)." });
      return json(res, 200, { consent: granted });
    }

    if (UNATTENDED_REVOKE.test(path)) {
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      const parsed = revokeBody.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "Send host_key." });
      const out = await deps.admin.revokeUnattended(viewer, parsed.data.host_key.trim().toLowerCase(), cleanReason(parsed.data.reason));
      if (!out.ok && out.error === "forbidden") return json(res, 403, { error: "Only the person who installed it, or a workspace admin, revokes unattended access." });
      if (!out.ok) return json(res, 404, { error: "No unattended access is recorded for that host." });
      return json(res, 200, { consent: out.consent });
    }

    const one = ONE.exec(path);
    if (one) {
      const id = one[1]!;
      const action = one[2]!;
      if (action === "logs") {
        if (method !== "GET") return json(res, 405, { error: "method not allowed" });
        const entries = deps.admin.logs(viewer, id);
        if (entries === null) return json(res, 403, { error: "You cannot see that remote session." });
        return json(res, 200, { entries });
      }
      if (action === "end") {
        if (method !== "POST") return json(res, 405, { error: "method not allowed" });
        const out = await deps.admin.end(viewer, id);
        if (out === "forbidden") return json(res, 403, { error: "You cannot end that remote session." });
        if (!out) return json(res, 404, { error: "That remote session is not open." });
        return json(res, 200, { ok: true });
      }
    }
    return json(res, 404, { error: "not found" });
  };
}
