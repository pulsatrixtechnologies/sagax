// @ts-nocheck
/** memberBotFieldRefusal (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMemberBotFieldRefusal(getHost: () => Host): any {
function memberBotFieldRefusal(auth: RequestAuth, body: unknown): { field: string; permission?: PermissionKey } | null {
  const host = getHost();

  if (!body || typeof body !== "object" || Array.isArray(body)) return { field: "body" };
  for (const field of Object.keys(body)) {
    if (host.isMemberBotField(field)) continue;
    // #1098: the bot's own session, the temporary one, My Chrome or one of
    // the owner's own profiles is the owner's environment; only a shared
    // profile of the server keeps bots.computer.
    if (field === "browserProfile" && !host.sharedBrowserProfileValue((body as Record<string, unknown>).browserProfile)) continue;
    const permission = BOT_FIELD_PERMISSIONS[field];
    if (!permission) return { field };
    // #1098 (2026-10-27): who sees their own bot is the owner's, on a served
    // workspace where they own it as a member of a team too (ownerKeepsSight
    // keeps them in the audience).
    if (field === "visibility" && host.IDENTITY.kind !== "perspicax") continue;
    if (host.IDENTITY.kind !== "perspicax" || !host.callerCan(auth, permission)) return { field, permission: host.IDENTITY.kind === "perspicax" ? permission : undefined };
  }
  return null;

}
  return memberBotFieldRefusal;
}
