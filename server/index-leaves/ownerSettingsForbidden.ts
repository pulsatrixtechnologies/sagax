// @ts-nocheck
/** ownerSettingsForbidden (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOwnerSettingsForbidden(getHost: () => Host): any {
function ownerSettingsForbidden(
  auth: RequestAuth,
  bot: { ownerUserId?: unknown } | null | undefined,
  writes: { model?: boolean; notifications?: boolean },
): { error: string; code: "owner_bot_settings"; field: "model" | "notifications" } | null {
  const host = getHost();

  if (!bot) return null;
  const field = crossOwnerSettingsRefusal({
    organization: host.IDENTITY.kind === "perspicax",
    ownerUserId: host.recordedBotOwner(bot),
    actorId: host.actorPrincipalId(auth),
    writesModel: writes.model === true,
    writesNotifications: writes.notifications === true
  });
  if (!field) return null;
  return {
    error: "This bot's model and notifications belong to its owner. Your own choices stay on your account.",
    code: "owner_bot_settings",
    field
  };

}
  return ownerSettingsForbidden;
}
