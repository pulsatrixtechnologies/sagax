// @ts-nocheck
/** viewerNotificationMuted (#1388). Pure move from server/index.ts. */
import { viewerWantsBotNotification } from "../../shared/viewer-bot-overrides.ts";
export type Host = Record<string, any>;

export function createViewerNotificationMuted(getHost: () => Host): any {
function viewerNotificationMuted(payload: Record<string, unknown>, viewerId: string | undefined) {
  const host = getHost();

  if (payload.kind !== "notify" || !payload.notification || typeof payload.notification !== "object") return false;
  const note = payload.notification as { kind?: unknown; botId?: unknown };
  if (note.kind === "spend" || typeof note.botId !== "string" || !note.botId) return false;
  const bot = host.store.bot(note.botId);
  if (!bot) return false;
  const person = viewerId?.trim().toLowerCase() ?? "";
  const override = person ? host.viewerBotOverrideStore.getOne(person, bot.id) : undefined;
  return !viewerWantsBotNotification({
    botNotifications: bot.notifications,
    ownerId: host.effectiveBotOwner(bot),
    viewerId: person || undefined,
    override: override?.notifications
  });

}
  return viewerNotificationMuted;
}
