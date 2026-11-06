// Full access in the approval menu (server/org/org-full-access.ts holds the
// rules the server enforces). On a solo server Full is granted through the
// packaged desktop app's private channel; on an organization server the
// bot's owner grants it over HTTP while the organization allows it.

/** How Full access shows in the menu on an organization server:
 * `allowed` (the owner may pick it), `disabled` (the organization turned
 * it off: shown greyed with a note), `hidden` (not the bot's owner).
 * undefined on a solo server, where the desktop rules apply. */
export type OrgFullAccess = "allowed" | "disabled" | "hidden";

export function orgFullAccessFor(
  org: { settings: { allowFullAccess?: boolean } } | null | undefined,
  bot: { ownerUserId?: string } | null | undefined,
  viewerId: string | null | undefined,
): OrgFullAccess | undefined {
  if (!org) return undefined;
  const owner = bot?.ownerUserId?.trim().toLowerCase();
  if (!owner || !viewerId || owner !== viewerId.trim().toLowerCase()) return "hidden";
  return org.settings.allowFullAccess === false ? "disabled" : "allowed";
}

/** Whether choosing Full asks for the warning. Always false since omb #2701
 * / PRO-RÈGLE: Full turns on at once with no confirmation dialog. Kept so
 * older call sites compile; arguments are ignored. */
export function fullAccessNeedsConfirmation(
  _bot?: { fullAccessConsent?: { principalId: string } } | null,
  _viewerId?: string | null,
  _organization?: boolean,
): boolean {
  return false;
}
