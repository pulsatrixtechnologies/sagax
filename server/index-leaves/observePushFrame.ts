// @ts-nocheck
/** observePushFrame (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

/** #4233: the pushes of one notify frame and the person's signal gate's
 * verdict on each (quiet hours, day budget; urgent always passes), decided
 * once on the frame's way out (fanoutSsePayload, through ruleNotifyFrame):
 * the desktop follows the same verdict as the phone, and observePushFrame
 * reuses it instead of asking the gate a second time. */
export interface DecidedPushes {
  messages: Record<string, any>[];
  decisions: ("push" | "hold")[];
  /** #4250 (S2): why each was held or let through (the one attention policy's reason). */
  reasons?: string[];
}

function framePushDeps(host: Host, options: { adminOnly?: boolean }) {
  const { effectiveBotOwner, privateThreadOwner, store } = host;
  return {
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
  };
}

/** #4233: asked once per frame (by ruleNotifyFrame in fanoutSsePayload), so
 * the gate counts the day's budget once per frame; observePushFrame reuses
 * the result instead of asking again. */
export function decideNotifyPushes(host: Host, payload: Record<string, unknown>, options: { adminOnly?: boolean } = {}): DecidedPushes {
  const messages = host.pushesForFrame(payload, framePushDeps(host, options));
  const verdicts = messages.map((message) => (host.signalGate ? host.signalGate.verdict(message) : null));
  const decisions = verdicts.map((verdict) => (verdict?.verdict === "hold" ? "hold" : "push"));
  return { messages, decisions, reasons: verdicts.map((verdict) => verdict?.reason ?? "allowed") };
}

export function createObservePushFrame(getHost: () => Host): any {
function observePushFrame(payload: Record<string, unknown>, options: { adminOnly?: boolean } = {}, decided?: DecidedPushes) {
  const host = getHost();
  const kind = payload.kind;
  if (kind !== "notify" && kind !== "nudge" && kind !== "achievements") return;
  // a conversation an AI client holds over MCP: never a phone or a watch
  if (!decided && kind === "notify" && (payload.notification as { quietOnPhones?: unknown } | undefined)?.quietOnPhones === true) return;
  // a message the bot wrote with notify false: in the chat, never a push
  // (#2695: one marked FYI is not pushed either, but its words wait for the brief)
  const fyi = kind === "notify" && (payload.notification as { level?: unknown } | undefined)?.level === "fyi";
  // (#4233: a frame the gate held went notify false, but its verdicts still reach "Me joindre" as before)
  if (!decided && kind === "notify" && !fyi && (payload.notification as { notify?: unknown } | undefined)?.notify === false) return;
  try {
    // #4233: a frame the person's signal gate already ruled carries its pushes and verdicts
    const messages = decided ? decided.messages : host.pushesForFrame(payload, framePushDeps(host, options));
    for (const [index, message] of messages.entries()) {
      // "Me joindre" (server/reach-me/): it goes by the bot's channels the
      // person allows for its level (#4250 S2: the one attention policy)
      // #2695: the person's signal level, daily budget and quiet hours come first
      // (an urgent card always goes); what waits is one line of the next brief
      // a bot that marked its message FYI (set_reply_notify fyi) waits for the brief too
      const signal = decided ? decided.decisions[index] : host.signalGate ? host.signalGate.decide(message, { fyi }) : "push";
      if (signal === "push" && (!host.reachMeService || host.reachMeService.allowsPush(message))) host.pushHub.submit(message);
      host.reachMeService?.cardRaised(message);
    }
  } catch (error) {
    console.warn(`push: a frame could not be read for pushes (${error instanceof Error ? error.message : String(error)})`);
  }

}
  return observePushFrame;
}
