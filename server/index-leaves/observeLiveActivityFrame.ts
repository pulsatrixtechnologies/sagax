// @ts-nocheck
/** observeLiveActivityFrame (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createObserveLiveActivityFrame(getHost: () => Host): any {
function observeLiveActivityFrame(payload: Record<string, unknown>) {
  const host = getHost();
  const { effectiveBotOwner, privateThreadOwner, store } = host;
  const kind = payload.kind;
  if (kind !== "notify" && kind !== "bot") return;
  try {
    const updates = host.liveActivityUpdatesForFrame(payload, {
      activityPeople: (note) => {
        if (host.IDENTITY.kind !== "perspicax") return [host.localPrincipalId()];
        const bot = note.botId ? store.bot(note.botId) : note.threadId ? store.botByThread(note.threadId) : undefined;
        if (!bot) return [];
        if (note.kind === "approval" || note.kind === "question") {
          return [host.cardAnswererId(bot, typeof note.threadId === "string" ? note.threadId : undefined, host.noteCard(note.threadId, (note as { requestId?: unknown }).requestId))];
        }
        const person = note.threadId ? privateThreadOwner(store.taskByThread(bot.id, note.threadId), effectiveBotOwner(bot)) : effectiveBotOwner(bot);
        return person ? [person] : [];
      },
      muted: (note, person) => host.viewerNotificationMuted({ kind: "notify", notification: note }, person),
      now: () => Date.now()
    });
    for (const update of updates) host.liveActivityHub.submit(update);
  } catch (error) {
    console.warn(`push-activity: a frame could not be read (${error instanceof Error ? error.message : String(error)})`);
  }

}
  return observeLiveActivityFrame;
}
