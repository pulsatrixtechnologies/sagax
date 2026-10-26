// The admin "Remote Sessions" page routes. Admin-scoped (/api/admin/...), so
// the tool policy marks them defaultEnabled false: an agent tool never reaches
// them without an explicit grant. A signed-in person reaches them from the
// account menu; the aggregator then enforces who may see each session (a
// workspace admin sees the organization's sessions, anyone else only their
// own) and who may record or revoke unattended consent (admins only). No
// tunnel address, key or secret ever enters a request or an answer.
import { z } from "zod";

import { PASS } from "./table.ts";
import type { RouteHandler } from "./table.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { AdminViewer, RemoteSessionsAdmin } from "../remote-sessions-admin.ts";

const LIST = /^\/api\/admin\/remote-sessions$/;
const UNATTENDED = /^\/api\/admin\/remote-sessions\/unattended$/;
const UNATTENDED_REVOKE = /^\/api\/admin\/remote-sessions\/unattended\/revoke$/;
const ONE = /^\/api\/admin\/remote-sessions\/([a-f0-9]{12})\/(logs|end)$/;

const grantBody = z.object({
  host_key: z.string().min(1).max(200),
  host_label: z.string().max(200).optional(),
  org: z.string().min(1).max(200),
  installed_by: z.string().min(1).max(200),
  scope: z.string().max(400).optional(),
  expires_at: z.string().max(40).optional(),
  banner_visible: z.boolean().optional(),
  tray_visible: z.boolean().optional(),
  signed: z.boolean().optional(),
  key_bound: z.boolean().optional(),
}).strict();

const revokeBody = z.object({ host_key: z.string().min(1).max(200) }).strict();

function boolParam(value: string | null): boolean {
  return value === "1" || value === "true";
}

export function createRemoteSessionsAdminRoutes(deps: {
  admin: RemoteSessionsAdmin;
  principalId(auth: RequestAuth): string | undefined;
  orgAdmin(auth: RequestAuth): boolean;
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
      return json(res, 200, { sessions, admin: viewer.orgAdmin, unattendedEnabled: deps.admin.unattendedEnabled() });
    }

    if (UNATTENDED.test(path)) {
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      const parsed = grantBody.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "Send host_key, org and installed_by. Consent is never silent." });
      const granted = deps.admin.grantUnattended(viewer, {
        hostKey: parsed.data.host_key,
        hostLabel: parsed.data.host_label,
        org: parsed.data.org,
        installedBy: parsed.data.installed_by,
        scope: parsed.data.scope,
        expiresAt: parsed.data.expires_at,
        bannerVisible: parsed.data.banner_visible,
        trayVisible: parsed.data.tray_visible,
        signed: parsed.data.signed,
        keyBound: parsed.data.key_bound,
      });
      if (granted === "disabled") return json(res, 501, { error: "Unattended access is not available yet (not enabled on this server)." });
      if (granted === "forbidden") return json(res, 403, { error: "Only a workspace admin records unattended consent." });
      if (!granted) return json(res, 400, { error: "That consent is incomplete (host, org or installer missing)." });
      return json(res, 200, { consent: granted });
    }

    if (UNATTENDED_REVOKE.test(path)) {
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      const parsed = revokeBody.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "Send host_key." });
      const out = await deps.admin.revokeUnattended(viewer, parsed.data.host_key.trim().toLowerCase());
      if (!out.ok && out.error === "disabled") return json(res, 501, { error: "Unattended access is not available yet (not enabled on this server)." });
      if (!out.ok && out.error === "forbidden") return json(res, 403, { error: "Only a workspace admin revokes unattended access." });
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
