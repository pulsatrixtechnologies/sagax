// The admin side of the Remote Sessions page: it aggregates every Tailcat
// session this server knows into the rows the page shows, enforces who may see
// them (a workspace admin sees the organization's sessions; anyone else sees
// only the sessions they own), and serves the redacted per-session log. It also
// records and revokes the install-time unattended consent. One Sagax server is
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
import type { UnattendedConsent, UnattendedConsentInput } from "../shared/remote-session-consent.ts";
import type { UnattendedConsentStore } from "./remote-session-consent-store.ts";

export interface AdminViewer {
  principalId: string;
  orgAdmin: boolean;
}

export type RevokeOutcome =
  | { ok: true; consent: UnattendedConsent }
  | { ok: false; error: "forbidden" | "not_found" | "disabled" };

export function createRemoteSessionsAdmin(deps: {
  /** Every stored session on this server, mapped to the admin input. */
  rows(): AdminSessionInput[];
  botLabel(botId: string): string;
  consent: UnattendedConsentStore;
  log(sessionId: string): RemoteSessionLogEntry[];
  /** End any session by id (service.adminClose). Cuts control and the tunnel. */
  closeById(id: string): Promise<boolean>;
  /** Propagate a revoke to the host service and Perspicax --allow binding.
   * Best effort; the consent is already marked revoked when this runs. */
  onRevoke?(consent: UnattendedConsent): Promise<void>;
  /** The unattended (Access) path is only usable when this is true. It is
   * false by default: the host service install, the revoke that uninstalls it,
   * and the expiry enforcement are designed but not wired yet, so the grant
   * and revoke actions are gated off until they are. */
  unattendedEnabled?(): boolean;
  now?: () => number;
}) {
  const now = deps.now ?? (() => Date.now());
  const unattendedEnabled = () => deps.unattendedEnabled?.() === true;

  const visible = (viewer: AdminViewer, input: AdminSessionInput) =>
    viewer.orgAdmin || input.ownerId === viewer.principalId;

  const rowFor = (input: AdminSessionInput): RemoteSessionAdminRow =>
    toAdminRow(input, {
      botLabel: deps.botLabel(input.botId),
      consent: deps.consent.get(adminHostKey(input)),
      now: now(),
    });

  const find = (id: string) => deps.rows().find((row) => row.id === id) ?? null;

  return {
    /** The rows this viewer may see, filtered and sorted. */
    list(viewer: AdminViewer, filters: AdminRowFilters = {}): RemoteSessionAdminRow[] {
      const mine = deps.rows().filter((input) => visible(viewer, input));
      return sortAdminRows(filterAdminRows(mine.map(rowFor), filters));
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
    /** Whether the unattended (Access) path is usable (feature flag). */
    unattendedEnabled,
    /** Record install-time unattended consent. Admin only. Gated off until the
     * host-service install, revoke-uninstall and expiry enforcement are wired. */
    grantUnattended(viewer: AdminViewer, input: UnattendedConsentInput): UnattendedConsent | null | "forbidden" | "disabled" {
      if (!unattendedEnabled()) return "disabled";
      if (!viewer.orgAdmin) return "forbidden";
      return deps.consent.grant(input);
    },
    /** Revoke unattended access for a host from the page (admin only): mark the
     * consent revoked, end any live session on that host (cuts the tunnel), and
     * propagate to the host service and Perspicax. */
    async revokeUnattended(viewer: AdminViewer, hostKey: string): Promise<RevokeOutcome> {
      if (!unattendedEnabled()) return { ok: false, error: "disabled" };
      if (!viewer.orgAdmin) return { ok: false, error: "forbidden" };
      const consent = deps.consent.revoke(hostKey);
      if (!consent) return { ok: false, error: "not_found" };
      // Cut any live session whose host matches, so revoke stops control now.
      for (const input of deps.rows()) {
        if (input.state === "connected" && adminHostKey(input) === hostKey) {
          await deps.closeById(input.id).catch(() => false);
        }
      }
      await deps.onRevoke?.(consent).catch(() => {});
      return { ok: true, consent };
    },
  };
}

export type RemoteSessionsAdmin = ReturnType<typeof createRemoteSessionsAdmin>;
