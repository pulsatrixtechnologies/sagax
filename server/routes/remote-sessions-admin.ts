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
import type { RequestAuth } from "../auth/request-auth.ts";
import type { AdminViewer, RemoteSessionsAdmin } from "../remote-support/remote-sessions-admin.ts";
import { cleanReason, REVOKE_REASON_MAX, type UnattendedHosts } from "../remote-support/remote-unattended-hosts.ts";
import type { UnattendedHostAccess, UnattendedHostRow, UnattendedHostShare } from "../../shared/remote-unattended-host.ts";

const LIST = /^\/api\/admin\/remote-sessions$/;
const UNATTENDED = /^\/api\/admin\/remote-sessions\/unattended$/;
const UNATTENDED_REVOKE = /^\/api\/admin\/remote-sessions\/unattended\/revoke$/;
const ONE = /^\/api\/admin\/remote-sessions\/([a-f0-9]{12})\/(logs|end)$/;
// Enrolled hosts (docs/inscription-hote.md): list, open unattended, revoke.
const HOSTS = /^\/api\/admin\/remote-sessions\/hosts$/;
const HOST_ACTION = /^\/api\/admin\/remote-sessions\/hosts\/(h_[0-9a-f]{32})\/(open|revoke)$/;
// Bot scope and sharing of an enrolled host (#2957).
const HOST_BOTS = /^\/api\/admin\/remote-sessions\/hosts\/(h_[0-9a-f]{32})\/bots$/;
const HOST_SHARES = /^\/api\/admin\/remote-sessions\/hosts\/(h_[0-9a-f]{32})\/shares(?:\/(person|team)\/([^/]{1,200}))?$/;

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

const hostBotsBody = z.object({ botIds: z.array(z.string().trim().min(1).max(200)).max(200).nullable() }).strict();
const hostShareBody = z.object({ kind: z.enum(["person", "team"]), id: z.string().trim().min(1).max(200) }).strict();

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
  /** The caller's per-host bot access (#2723), stamped on each host row. */
  hostAccess?(principalId: string): Map<string, UnattendedHostAccess>;
  /** Bot scope and sharing of the caller's hosts (#2957). Absent: rows carry
   * neither and the bots / shares routes answer 404. */
  hostSharing?: {
    botScopes(principalId: string): Map<string, string[]>;
    setBotScope(principalId: string, hostId: string, botIds: string[] | null): string[] | null;
    /** True when the bot is one of the person's own. */
    ownsBot(principalId: string, botId: string): boolean;
    sharesByOwner(principalId: string): Map<string, { kind: "person" | "team"; id: string }[]>;
    share(principalId: string, hostId: string, target: { kind: "person" | "team"; id: string }): { kind: "person" | "team"; id: string }[];
    unshare(principalId: string, hostId: string, target: { kind: "person" | "team"; id: string }): { kind: "person" | "team"; id: string }[];
    /** The display name of a person or team of the org; null when unknown. */
    targetName(target: { kind: "person" | "team"; id: string }): string | null;
    /** Drops the scope and shares of a host the owner just revoked. */
    forget?(principalId: string, hostId: string): void;
  };
}): RouteHandler {
  const sharesOf = (principalId: string, hostId: string, list?: { kind: "person" | "team"; id: string }[]): UnattendedHostShare[] =>
    (list ?? deps.hostSharing?.sharesByOwner(principalId).get(hostId) ?? [])
      .map((share) => ({ ...share, name: deps.hostSharing?.targetName(share) ?? "" }))
      .filter((share) => share.name);
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
      const chosen = deps.hostAccess?.(principalId);
      const scopes = deps.hostSharing?.botScopes(principalId);
      const shared = deps.hostSharing?.sharesByOwner(principalId);
      if (!chosen && !deps.hostSharing) return json(res, 200, listed);
      const hosts: UnattendedHostRow[] = listed.hosts.map((row) => ({
        ...row,
        ...(chosen ? { access: chosen.get(row.hostId) ?? "always" } : {}),
        ...(scopes ? { bots: scopes.get(row.hostId) ?? null } : {}),
        // Shares are the owner's business: a shared row never lists them.
        ...(shared && !row.sharedBy ? { shares: sharesOf(principalId, row.hostId, shared.get(row.hostId)) } : {}),
      }));
      return json(res, 200, { ...listed, hosts });
    }

    const hostBots = HOST_BOTS.exec(path);
    if (hostBots && deps.hosts && deps.hostSharing) {
      if (method !== "PUT") return json(res, 405, { error: "method not allowed" });
      const hostId = hostBots[1]!;
      const parsed = hostBotsBody.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "Send botIds: a list of bot ids, or null for all bots." });
      const listed = await deps.hosts.list({ principalId });
      if (!listed.available) return json(res, 409, { error: listed.reason });
      const row = listed.hosts.find((host) => host.hostId === hostId && host.state !== "revoked");
      if (!row) return json(res, 404, { error: "That computer is not one of your enrolled hosts." });
      const foreign = (parsed.data.botIds ?? []).filter((botId) => !deps.hostSharing!.ownsBot(principalId, botId));
      if (foreign.length) return json(res, 400, { error: "Only your own bots can be allowed on a computer." });
      const bots = deps.hostSharing.setBotScope(principalId, hostId, parsed.data.botIds);
      return json(res, 200, { bots });
    }

    const hostShares = HOST_SHARES.exec(path);
    if (hostShares && deps.hosts && deps.hostSharing) {
      const hostId = hostShares[1]!;
      const listed = await deps.hosts.list({ principalId });
      if (!listed.available) return json(res, 409, { error: listed.reason });
      // Only the owner shares: a host reaching the caller through a share is "not theirs" here.
      const row = listed.hosts.find((host) => host.hostId === hostId && host.state !== "revoked" && !host.sharedBy);
      if (!row) return json(res, 404, { error: "That computer is not one of your enrolled hosts." });
      if (method === "GET" && !hostShares[2]) return json(res, 200, { shares: sharesOf(principalId, hostId) });
      if (method === "PUT" && !hostShares[2]) {
        const parsed = hostShareBody.safeParse(await readBody(req));
        if (!parsed.success) return json(res, 400, { error: "Send kind (person or team) and id." });
        const target = parsed.data;
        if (target.kind === "person" && target.id.toLowerCase() === principalId.toLowerCase()) {
          return json(res, 400, { error: "This computer is already yours." });
        }
        if (!deps.hostSharing.targetName(target)) return json(res, 404, { error: "That person or team is not in your organization." });
        const shares = deps.hostSharing.share(principalId, hostId, target);
        return json(res, 200, { shares: sharesOf(principalId, hostId, shares) });
      }
      if (method === "DELETE" && hostShares[2]) {
        let id = "";
        try { id = decodeURIComponent(hostShares[3]!); } catch { return json(res, 400, { error: "Bad share id." }); }
        const shares = deps.hostSharing.unshare(principalId, hostId, { kind: hostShares[2] as "person" | "team", id });
        return json(res, 200, { shares: sharesOf(principalId, hostId, shares) });
      }
      return json(res, 405, { error: "method not allowed" });
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
      if (out.ok) {
        deps.hostSharing?.forget?.(principalId, hostId);
        return json(res, 200, { ok: true });
      }
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
