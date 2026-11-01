// The enrolled hosts of the Remote Sessions page (contract: sagax-remote-access
// docs/inscription-hote.md, "Côté Sagax"): list the hosts Perspicax enrolled
// for unattended access, open an unattended session against one (host_id, not
// a code), and revoke one. Perspicax is the authority on every host: it
// refuses a revoked or expired host (C1), intersects the scope with the
// enrollment, and tells the host at its next beat.
//
// Calls go to Perspicax in the name of the person on the page, through the
// Perspicax MCP link a bot of theirs mounts (the same relay as a turn), so a
// session opened here becomes the usual card and panel row (client "app")
// through the remote_support_* registrar, and "Prendre le contrôle" takes over.
//
// Rules (decisions of 2026-10-26 and 2026-11-01): unattended access is always
// enabled server-side (it is not a mode and cannot be disabled). Any person
// who reaches this server may open (no admin approval). Listing and revoking
// always work. The person who enrolled a host revokes it themselves, an admin
// revokes any host of the organization: Perspicax decides, Sagax adds no gate
// of its own. The audit (`remote_host.revoked`) names the person who acted,
// never the installer (M4), with the host, the reason and the UTC time. No
// key, no address and no host id ever reaches visible text. Safeguards that
// stay: org consent at host install, visible banner/tray on the host,
// non-disableable audit, expiry, revoke.
import {
  hostOwnedByPerson,
  parseUnattendedHostId,
  parseUnattendedHosts,
  type UnattendedHostRow,
} from "../shared/remote-unattended-host.ts";
import { handleRemoteSupportCall, openUnattendedSession, type RemoteSupportContext } from "./remote-support-local.ts";

/** Perspicax tools this page calls (names frozen with Perspicax, contract
 * docs/inscription-hote.md). A server without them reads as "not available". */
export const HOSTS_LIST_TOOL = "remote_support_hosts";
export const HOST_REVOKE_TOOL = "remote_support_host_revoke";

/** One person's link to Perspicax for a page action: a bot of theirs with a
 * Perspicax profile, its conversation (where the session card lands), and one
 * call in their name. `end` releases the link. */
export interface PerspicaxSeat {
  botId: string;
  threadId: string;
  /** One tool call; the body has the shape of /api/internal/perspicax/tool
   * (`text`, `isError`, `owner`). */
  call(tool: string, args: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }>;
  end(): Promise<void>;
}

export interface UnattendedHostsViewer {
  principalId: string;
}

export interface UnattendedHostAuditEvent {
  at: number;
  /** The person who acted on the page (M4), never the installer. */
  actor: string;
  kind: "unattended.open" | "remote_host.revoked";
  hostId: string;
  ok: boolean;
  /** remote_host.revoked: the reason given ("" when none). */
  reason?: string;
  /** unattended.open: scope and rights asked for, and the bot whose Perspicax seat opened it. */
  scope?: string;
  rights?: string;
  botId?: string;
}

export type HostsListOutcome = { available: true; hosts: UnattendedHostRow[] } | { available: false; hosts: []; reason: string };
export type HostOpenOutcome =
  | { ok: true; code: string; botId: string; threadId: string }
  | { ok: false; error: "invalid" | "unavailable" | "refused" | "not_found"; message: string };
export type HostRevokeOutcome = { ok: true } | { ok: false; error: "invalid" | "unavailable" | "refused"; message: string };

const NOT_AVAILABLE = "Perspicax does not list enrolled computers yet on this server.";
const NO_SEAT = "None of your bots is linked to Perspicax, so Sagax cannot reach it for you.";

function answerObject(text: unknown): Record<string, unknown> | null {
  if (typeof text !== "string") return text && typeof text === "object" && !Array.isArray(text) ? text as Record<string, unknown> : null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function refusal(posted: { status: number; body: Record<string, unknown> }): string | null {
  if (posted.status < 400 && posted.body.isError !== true && !posted.body.error) return null;
  const said = typeof posted.body.text === "string" ? posted.body.text : typeof posted.body.error === "string" ? posted.body.error : "";
  return said.slice(0, 400) || "Perspicax refused the call.";
}

/** The longest revocation reason, as Perspicax keeps it. */
export const REVOKE_REASON_MAX = 256;

/** A revocation reason: one line, no control character, at most
 * REVOKE_REASON_MAX characters; "" when none. */
export function cleanReason(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, REVOKE_REASON_MAX);
}

/** A status answer that means the session is done (or never coming). */
function finished(text: string): "connected" | "over" | null {
  const state = answerObject(text.split("\n")[0])?.state;
  if (state === "connected") return "connected";
  if (state === "ended" || state === "cancelled" || state === "expired" || state === "closed") return "over";
  return null;
}

export function createUnattendedHosts(deps: {
  /** The person's Perspicax link, or a reason it cannot be made. */
  seat(principalId: string): Promise<PerspicaxSeat | { error: string }>;
  /** The technician side on this computer (support folder, name, org). */
  local(principalId: string): RemoteSupportContext;
  /** End a Sagax session row by its 12-hex id (cuts control and the tunnel). */
  closeById(id: string): Promise<boolean>;
  audit(event: UnattendedHostAuditEvent): void;
  /** Perspicax subject for the Sagax principal. Used to enforce ownership
   * when the host list is wider than the person (defense in depth). */
  ownerSub?(principalId: string): string | null;
  /** How often and how long the page's open waits for the host's beat. The
   * host polls every `poll_every` (10 s by default), so a minute and a half
   * covers a few missed beats. */
  statusEveryMs?: number;
  statusTries?: number;
  sleep?(ms: number): Promise<void>;
  now?: () => number;
}) {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const every = deps.statusEveryMs ?? 3_000;
  const tries = deps.statusTries ?? 30;
  /** Sessions opened from this page, per host: revoke ends them here too. */
  const openedFor = new Map<string, Set<string>>();
  const revoked = new Set<string>();

  /** One short call in the person's name; the link ends right after. */
  async function withSeat<T>(principalId: string, work: (seat: PerspicaxSeat) => Promise<T>): Promise<T | { error: string }> {
    const seat = await deps.seat(principalId).catch(() => ({ error: NO_SEAT }));
    if ("error" in seat) return seat;
    try {
      return await work(seat);
    } finally {
      await seat.end().catch(() => {});
    }
  }

  /** Follow a fresh open until the host picked it up: every status goes
   * through the relay, so the registrar posts the card once it says connected.
   * Runs in the background; the seat ends with it. */
  async function follow(seat: PerspicaxSeat, local: RemoteSupportContext, hostId: string, code: string): Promise<void> {
    try {
      for (let i = 0; i < tries; i += 1) {
        await sleep(every);
        if (revoked.has(hostId)) return;
        const answer = await handleRemoteSupportCall({ name: "remote_support_status", args: { code }, local, post: seat.call }).catch(() => null);
        if (!answer || answer.isError) return;
        if (finished(answer.text)) return;
      }
    } finally {
      await seat.end().catch(() => {});
    }
  }

  async function list(viewer: UnattendedHostsViewer): Promise<HostsListOutcome> {
    const out = await withSeat(viewer.principalId, async (seat) => {
      const posted = await seat.call(HOSTS_LIST_TOOL, {});
      if (refusal(posted)) return null;
      return parseUnattendedHosts(answerObject(posted.body.text), now());
    });
    if (out && "error" in out) return { available: false, hosts: [], reason: out.error };
    if (!out) return { available: false, hosts: [], reason: NOT_AVAILABLE };
    return { available: true, hosts: out };
  }

  return {
    /** The hosts enrolled in this person's organization. */
    list,

    /** Open an unattended session against an enrolled host. No admin
     * approval: any person who reaches this server may (decision of 2026-10-26).
     * Always available: unattended access is not a server mode (2026-11-01).
     * Ownership: the host must be one of theirs (installed_by matches their
     * Perspicax subject, or listed as theirs when no subject is known). */
    async open(viewer: UnattendedHostsViewer, rawHostId: string, options: { scope?: string; rights?: string } = {}): Promise<HostOpenOutcome> {
      const hostId = parseUnattendedHostId(rawHostId);
      if (!hostId) return { ok: false, error: "invalid", message: "That computer is not an enrolled host." };
      const scope = typeof options.scope === "string" && options.scope ? options.scope : "full-control";
      const rights = options.rights === "elevated" ? "elevated" : "standard";
      const auditOpen = (ok: boolean, botId?: string) => deps.audit({
        at: now(),
        actor: viewer.principalId,
        kind: "unattended.open",
        hostId,
        ok,
        scope,
        rights,
        ...(botId ? { botId } : {}),
      });
      // Defense in depth: refuse another person's host even when the list
      // tool still returns the whole org (Perspicax MCP parallel fix).
      const listed = await list(viewer);
      if (!listed.available) {
        auditOpen(false);
        return { ok: false, error: "unavailable", message: listed.reason };
      }
      const row = listed.hosts.find((host) => host.hostId === hostId);
      const sub = deps.ownerSub?.(viewer.principalId) ?? null;
      if (!row || row.state !== "enrolled" || !hostOwnedByPerson(row, sub)) {
        auditOpen(false);
        return { ok: false, error: "not_found", message: "That computer is not one of your enrolled hosts." };
      }
      const local = deps.local(viewer.principalId);
      const seat = await deps.seat(viewer.principalId).catch(() => ({ error: NO_SEAT }));
      if ("error" in seat) {
        auditOpen(false);
        return { ok: false, error: "unavailable", message: seat.error };
      }
      const out = await openUnattendedSession({
        hostId,
        args: { ...(options.scope ? { scope: options.scope } : {}), ...(options.rights ? { rights: options.rights } : {}) },
        local,
        post: seat.call,
      }).catch(() => ({ ok: false as const, error: "Perspicax could not be reached." }));
      if (!out.ok) {
        await seat.end().catch(() => {});
        auditOpen(false, seat.botId);
        return { ok: false, error: "refused", message: out.error };
      }
      revoked.delete(hostId);
      const ids = openedFor.get(hostId) ?? new Set<string>();
      ids.add(out.session);
      openedFor.set(hostId, ids);
      auditOpen(true, seat.botId);
      void follow(seat, local, hostId, out.code);
      return { ok: true, code: out.code, botId: seat.botId, threadId: seat.threadId };
    },

    /** Revoke a host: Perspicax lets the person who enrolled it and any
     * admin, sets revoked_at and ends the host's sessions; the host stops
     * and uninstalls at its next beat (410). Sessions opened from this
     * page end here at once. */
    async revoke(viewer: UnattendedHostsViewer, rawHostId: string, rawReason = ""): Promise<HostRevokeOutcome> {
      const hostId = parseUnattendedHostId(rawHostId);
      if (!hostId) return { ok: false, error: "invalid", message: "That computer is not an enrolled host." };
      const reason = cleanReason(rawReason);
      const out = await withSeat(viewer.principalId, async (seat) => ({
        refused: refusal(await seat.call(HOST_REVOKE_TOOL, reason ? { host_id: hostId, reason } : { host_id: hostId })),
      }));
      const unavailable = "error" in out ? out.error : null;
      const refused = "refused" in out ? out.refused : null;
      deps.audit({ at: now(), actor: viewer.principalId, kind: "remote_host.revoked", hostId, ok: !unavailable && !refused, reason });
      if (unavailable) return { ok: false, error: "unavailable", message: unavailable };
      if (refused) return { ok: false, error: "refused", message: refused };
      revoked.add(hostId);
      for (const id of openedFor.get(hostId) ?? []) await deps.closeById(id).catch(() => false);
      openedFor.delete(hostId);
      return { ok: true };
    },
  };
}

export type UnattendedHosts = ReturnType<typeof createUnattendedHosts>;
