// @ts-nocheck
/** observePushFrame (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createObservePushFrame(getHost: () => Host): any {
function observePushFrame(payload: Record<string, unknown>, options: { adminOnly?: boolean } = {}) {
  const host = getHost();
  const { effectiveBotOwner, privateThreadOwner, store } = host;
  const kind = payload.kind;
  if (kind !== "notify" && kind !== "nudge" && kind !== "achievements") return;
  // a conversation an AI client holds over MCP: never a phone or a watch
  if (kind === "notify" && (payload.notification as { quietOnPhones?: unknown } | undefined)?.quietOnPhones === true) return;
  // a message the bot wrote with notify false: in the chat, never a push
  // (#2695: one marked FYI is not pushed either, but its words wait for the brief)
  const fyi = kind === "notify" && (payload.notification as { level?: unknown } | undefined)?.level === "fyi";
  if (kind === "notify" && !fyi && (payload.notification as { notify?: unknown } | undefined)?.notify === false) return;
  try {
    const messages = host.pushesForFrame(payload, {
      notificationPeople: (note) => {
        // #3719: a frame for the admins reaches the admins' phones only, never the bot's owner
        if (options.adminOnly) return host.moderationAdminAudience();
        if (host.IDENTITY.kind !== "perspicax") return [host.localPrincipalId()];
        const bot = note.botId ? store.bot(note.botId) : note.threadId ? store.botByThread(note.threadId) : undefined;
        if (!bot) return [];
        if (note.kind === "approval") return [host.cardAnswererId(bot, typeof note.threadId === "string" ? note.threadId : undefined, host.noteCard(note.threadId, (note as { requestId?: unknown }).requestId))];
        const person = note.threadId ? privateThreadOwner(store.taskByThread(bot.id, note.threadId), effectiveBotOwner(bot)) : effectiveBotOwner(bot);
        return person ? [person] : [];
      },
      muted: (note, person) => host.viewerNotificationMuted({ kind: "notify", notification: note }, person),
      achievementNotifications: (person) => {
        try {
          return host.achievementStore.snapshot(person).settings.native === true;
        } catch {
          return false;
        }
      },
      achievementName: (id, person) => {
        const item = host.achievementById(id);
        if (!item) return undefined;
        let language = "";
        try {
          if (host.IDENTITY.kind === "perspicax") language = host.userPreferenceStore.get(person).preferences["omb-language"] ?? "";
        } catch { /* the default language */ }
        return language.toLowerCase().startsWith("fr") ? item.name.fr : item.name.en;
      },
      // the bot's mascot on the phone's banner (docs/ios-push.md)
      botLook: (botId) => {
        const bot = store.bot(botId);
        return bot ? host.pushSenderLook(bot) : undefined;
      },
      now: () => Date.now()
    });
    for (const message of messages) {
      // "Me joindre" (server/reach-me/): a card follows the person's choice
      // for its bot (push or not, their hours) and goes out by their other channels
      // #2695: the person's signal level, daily budget and quiet hours come first
      // (an urgent card always goes); what waits is one line of the next brief
      // a bot that marked its message FYI (set_reply_notify fyi) waits for the brief too
      const signal = host.signalGate ? host.signalGate.decide(message, { fyi }) : "push";
      if (signal === "push" && (!host.reachMeService || host.reachMeService.allowsPush(message))) host.pushHub.submit(message);
      host.reachMeService?.cardRaised(message);
    }
  } catch (error) {
    console.warn(`push: a frame could not be read for pushes (${error instanceof Error ? error.message : String(error)})`);
  }

}
  return observePushFrame;
}
