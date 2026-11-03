// Team map teams (`bot.section`, shared instructions, team memory, team
// computers) are installation-wide. Routes under /api/sidebar-sections stay
// admin scope (server/auth/request-auth.ts). Personal sidebar sections are a
// different thing (src/lib/personal-sections.ts) and stay available to every
// member. Hide create/edit/delete/move when the session cannot write them.
import { ApiError } from "@/state/store";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { isOwnerOrAdmin, type SessionState } from "@/lib/session";

/** Whether this viewer may create, rename, move bots between, or delete a
 * team on the Team map. A remote client never may; otherwise the session
 * needs the admin scope. */
export function canManageTeamMap(session: SessionState | null, remoteClient = false): boolean {
  return !remoteClient && isOwnerOrAdmin(session);
}

/** Words for a Team map mutation that failed: the admin-scope refusal becomes
 * the same plain sentence the page shows when create is hidden; anything else
 * goes through readableError so a raw English server line never appears. */
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
