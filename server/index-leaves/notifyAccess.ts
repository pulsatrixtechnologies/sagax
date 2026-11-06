// @ts-nocheck
/** notifyAccess (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createNotifyAccess(getHost: () => Host): any {
function notifyAccess(notification: Notification | null, access: WireAccessCard, routineRunId?: string) {
  const host = getHost();
  const { DATA_DIR } = host;

  if (!notification) return;
  // A refused turn, for the console's Overview (server/org/org-problem-log.ts).
  const refusedBot = host.store.bot(access.botId);
  // a confidential thread's row names nothing of it (server/threads/confidential-threads.ts)
  const refusedConfidential = host.store.isConfidentialThread(notification.threadId);
  void host.appendProblem(DATA_DIR, {
    kind: "refused", botId: access.botId, botName: refusedBot?.name ?? access.botId, ownerPrincipalId: access.ownerPrincipalId || null,
    threadId: notification.threadId, title: refusedBot && !refusedConfidential ? host.store.taskByThread(refusedBot.id, notification.threadId)?.title ?? null : null,
    engine: refusedBot?.modelSelection?.instanceId ?? null,
    reason: access.cause === "payer_disabled" || access.cause === "server_engine_not_allowed" ? access.cause : access.reason,
    detail: refusedConfidential ? host.CONFIDENTIAL_INCIDENT_TEXT : host.redactSecretsInText(notification.body ?? "")
  }).catch(host.reportBackgroundError);
  if (host.IDENTITY.kind !== "perspicax") return host.notify(notification);
  const bot = host.store.bot(access.botId);
  const inRoom = Boolean(host.store.groupByThread(notification.threadId));
  const copies = host.routineAccessNotifications(notification, host.accessCardAudience(access), {
    ...(routineRunId && bot && !inRoom ? { routineRunId } : {}),
    readable: (principalId) => Boolean(bot) && host.botThreadReadable(bot!, notification.threadId, principalId, "thread.read")
  });
  for (const copy of copies) host.notify(copy);

}
  return notifyAccess;
}
