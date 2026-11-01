// The admin side of the Remote Sessions page: it aggregates every Tailcat
// session this server knows into the rows the page shows, enforces who may see
// them (a workspace admin sees the organization's sessions; anyone else sees
// only the sessions they own), and serves the redacted per-session log. It also
// records and revokes the install-time unattended consent: any signed-in
// person for a host of their own, recorded under their principal; an admin
// for any host. One Sagax server is
// one organization, so "org isolation" here is: no row leaves this server, and
// a non-admin never sees another person's session.
import {
  adminHostKey,
  filterAdminRows,
  sortAdminRows,
  toAdminRow,
  type AdminRowFilters,
  type AdminSessionInput,
  type RemoteSessionAdminRow,
} from "../shared/remote-session-admin.ts";
import type { RemoteSessionLogEntry } from "../shared/remote-session-admin.ts";
import { isUnattendedActive, normalizeHostKey, type UnattendedConsent, type UnattendedConsentInput } from "../shared/remote-session-consent.ts";
import type { UnattendedConsentStore } from "./remote-session-consent-store.ts";

export interface AdminViewer {
  principalId: string;
  orgAdmin: boolean;
}

export type RevokeOutcome =
  | { ok: true; consent: UnattendedConsent }
  | { ok: false; error: "forbidden" | "not_found" };

export function createRemoteSessionsAdmin(deps: {
  /** Every stored session on this server, mapped to the admin input. */
  rows(): AdminSessionInput[];
  botLabel(botId: string): string;
  consent: UnattendedConsentStore;
  log(sessionId: string): RemoteSessionLogEntry[];
  /** End any session by id (service.adminClose). Cuts control and the tunnel. */
  closeById(id: string): Promise<boolean>;
  /** Propagate a revoke to the host service and Perspicax --allow binding.
   * Best effort; the consent is already marked revoked when this runs.
   * `actor` is the person who revoked (the installer themselves or an admin),
   * for the audit (M4); `reason` the one they gave ("" when none). */
  onRevoke?(consent: UnattendedConsent, actor: string, reason: string): Promise<void>;
  now?: () => number;
}) {
  const now = deps.now ?? (() => Date.now());

  const visible = (viewer: AdminViewer, input: AdminSessionInput) =>
    viewer.orgAdmin || input.ownerId === viewer.principalId;

  const rowFor = (input: AdminSessionInput, viewer?: AdminViewer): RemoteSessionAdminRow => {
    const consent = deps.consent.get(adminHostKey(input));
    const row = toAdminRow(input, { botLabel: deps.botLabel(input.botId), consent, now: now() });
    // The person who recorded the consent revokes it themselves (their own
    // environment, no admin): the page offers Revoke on their rows.
    return viewer && row.unattended && consent?.installedBy === viewer.principalId ? { ...row, unattendedMine: true } : row;
  };

  const find = (id: string) => deps.rows().find((row) => row.id === id) ?? null;

  const samePrincipal = (a: string | undefined | null, b: string | undefined | null) =>
    !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

  /** Whether a non-admin may act on this host's unattended consent: no
   * session of another person runs on it, and no live consent of another
   * person covers it. An admin may act on any host. */
  const hostIsTheirs = (viewer: AdminViewer, hostKey: string): boolean => {
    if (viewer.orgAdmin) return true;
    if (deps.rows().some((input) => adminHostKey(input) === hostKey && !samePrincipal(input.ownerId, viewer.principalId))) return false;
    const current = deps.consent.get(hostKey);
    return !current || !isUnattendedActive(current, now()) || samePrincipal(current.installedBy, viewer.principalId);
  };

  return {
    /** The rows this viewer may see, filtered and sorted. */
    list(viewer: AdminViewer, filters: AdminRowFilters = {}): RemoteSessionAdminRow[] {
      const mine = deps.rows().filter((input) => visible(viewer, input));
      return sortAdminRows(filterAdminRows(mine.map((input) => rowFor(input, viewer)), filters));
    },
    /** Whether the viewer may see / act on this session. */
    canSee(viewer: AdminViewer, id: string): boolean {
      const input = find(id);
      return Boolean(input && visible(viewer, input));
    },
    /** The redacted log for a session, or null when the viewer may not see it. */
    logs(viewer: AdminViewer, id: string): RemoteSessionLogEntry[] | null {
      return this.canSee(viewer, id) ? deps.log(id) : null;
    },
    /** End a session the viewer may see. Returns false when it is gone. */
    async end(viewer: AdminViewer, id: string): Promise<boolean | "forbidden"> {
      if (!this.canSee(viewer, id)) return "forbidden";
      return deps.closeById(id);
    },
    /** Record install-time unattended consent, attributed to the caller's
     * principal. Any signed-in person may, for a host that is not another
     * person's (hostIsTheirs); an admin for any host. Always available:
     * unattended access is not a server mode (2026-11-01). */
    grantUnattended(viewer: AdminViewer, input: Omit<UnattendedConsentInput, "installedBy">): UnattendedConsent | null | "forbidden" {
      if (!viewer.principalId) return "forbidden";
      const hostKey = normalizeHostKey(input.hostKey);
      if (hostKey && !hostIsTheirs(viewer, hostKey)) return "forbidden";
      return deps.consent.grant({ ...input, installedBy: viewer.principalId });
    },
    /** Revoke unattended access for a host from the page: the person who
     * recorded the consent (installedBy) does it themselves, an admin does it
     * for any host of the organization (decision 2026-10-26). Mark the consent
     * revoked, end the live sessions on that host the caller may end (cuts the
     * tunnel), and propagate to the host service and Perspicax. */
    async revokeUnattended(viewer: AdminViewer, hostKey: string, reason = ""): Promise<RevokeOutcome> {
      if (!viewer.principalId && !viewer.orgAdmin) return { ok: false, error: "forbidden" };
      const current = deps.consent.get(hostKey);
      if (!current) return { ok: false, error: "not_found" };
      if (!viewer.orgAdmin && !samePrincipal(current.installedBy, viewer.principalId)) return { ok: false, error: "forbidden" };
      const consent = deps.consent.revoke(hostKey);
      if (!consent) return { ok: false, error: "not_found" };
      // Cut the live sessions on that host, so revoke stops control now. A
      // non-admin never ends another person's session.
      for (const input of deps.rows()) {
        if (input.state === "connected" && adminHostKey(input) === hostKey && (viewer.orgAdmin || samePrincipal(input.ownerId, viewer.principalId))) {
          await deps.closeById(input.id).catch(() => false);
        }
      }
      await deps.onRevoke?.(consent, viewer.principalId, reason).catch(() => {});
      return { ok: true, consent };
    },
  };
}

export type RemoteSessionsAdmin = ReturnType<typeof createRemoteSessionsAdmin>;
