// @ts-nocheck
/** notificationQuietOnPhones (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createNotificationQuietOnPhones(getHost: () => Host): any {
function notificationQuietOnPhones(notification: Notification) {
  const host = getHost();
  const { isAgentConversation } = host;

  if (notification.kind === "approval" || notification.kind === "question") return false;
  if (!notification.threadId) return false;
  // 2026-11-02: a routine run's thread is hidden, but what it asks is the
  // person's (prod: an approval never reached the phone and expired). Only an
  // AI client's hidden conversation stays off phones.
  if (host.notificationInHiddenThread(notification.threadId) && !host.routineRunThread(notification.threadId)) return true;
  const bot = host.store.botByThread(notification.threadId);
  return Boolean(bot && isAgentConversation(host.store.taskByThread(bot.id, notification.threadId)));

}
  return notificationQuietOnPhones;
}
