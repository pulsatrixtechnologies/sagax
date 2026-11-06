// Team map write access (#2045).
//
// - Organization server: each person manages their own teams (sidebar groups).
//   Create, rename, nest, fill and delete stay with the person; no admin right
//   is required. Remote clients stay read-only.
// - Solo server: /api/sidebar-sections is admin scope (requiredScope), so only
//   the owner/admin session writes the shared team list.
// - Team computers (Boat cost) stay with host.shell / admin on both modes.
import { ApiError } from "@/state/store";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { isOwnerOrAdmin, type SessionState } from "@/lib/session";

/** Whether this viewer may create, rename, move bots between, or delete a
 * team on the Team map.
 * On an organization server every signed-in member manages their own teams.
 * On a solo server the session needs the admin scope. A remote client never
 * may. */
export function canManageTeamMap(
  session: SessionState | null,
  remoteClient = false,
  orgMode = false,
): boolean {
  if (remoteClient || !session) return false;
  if (orgMode) {
    if (session.kind === "loopback") return session.trust !== "service";
    return session.kind === "session" && session.scopes.includes("client");
  }
  return isOwnerOrAdmin(session);
}

/** Words for a Team map mutation that failed: the admin-scope refusal becomes
 * the same plain sentence the page shows when create is hidden on a solo
 * server; anything else goes through readableError so a raw English server
 * line never appears. */
export function teamMapMutationError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause);
  if (
    (cause instanceof ApiError && cause.status === 403 && /lacks the admin scope/i.test(raw))
    || /forbidden:\s*this session lacks the admin scope/i.test(raw)
  ) {
    return t("team.adminOnly");
  }
  return readableError(cause);
}
