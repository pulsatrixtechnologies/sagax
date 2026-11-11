// @ts-nocheck
/** pendingExpiryDeps (#1388). Pure move from server/index.ts. */
import { lastPersonText, turnLanguage } from "../turns/turn-language.ts";
export type Host = Record<string, any>;

export function createPendingExpiryDeps(getHost: () => Host): any {
function pendingExpiryDeps() {
  const host = getHost();
  const { DATA_DIR, appendDecision } = host;

  return {
    open: host.openPendingInboxCards,
    daysFor: (row) => host.pendingExpireDaysForThread(row.threadId),
    patch: (threadId, messageId, card) => { host.store.patchMessage(threadId, messageId, { card }); },
    note: (threadId, text) => {
      host.store.appendMessage(threadId, { role: "bot", kind: "text", text });
    },
    release: ({ threadId, requestId, card, note }) => {
      const bot = host.store.botByThread(threadId);
      const instanceId = bot?.modelSelection?.instanceId;
      const instance = host.runningTurnEngines.get(threadId) ?? (instanceId ? host.registry.get(instanceId) : undefined);
      // #3471: a question refuses a deny, so it is answered with the note
      void instance?.adapter.respondToRequest(threadId, requestId, { behavior: card?.tool ? "deny" : "answer", message: note }).catch(() => { /* request may already be gone */ });
      // #3514: the turn that posted the card hears it now, not at its end
      host.cardTurnSettledByRequest?.(threadId, requestId);
      host.askMessageByRequest.delete(`${threadId}:${requestId}`);
      host.pendingCommandRules.delete(`${threadId}:${requestId}`);
      host.settleWaitingActivity(threadId);
    },
    journal: ({ threadId, requestId, tool, summary, botId, botName }) => {
      appendDecision(DATA_DIR, {
        threadId, requestId, botId, botName, tool, summary,
        decision: "expired", source: "timeout",
      });
    },
    withdraw: host.withdrawApprovalNotice,
    botOf: (threadId) => {
      const bot = host.store.botByThread(threadId);
      return bot ? { id: bot.id, name: bot.name } : undefined;
    },
    // #3522: the language of the person who owns the conversation, as a
    // turn picks it for a server line: the language of their last message
    // there, else their own choice (the conversation's person, else the
    // bot's owner, else the server's default). At a start, before any
    // request, a saved choice may be missing: the conversation still tells.
    localeFor: (threadId) => {
      const bot = host.store.botByThread(threadId);
      const task = bot ? host.store.taskByThread?.(bot.id, threadId) : undefined;
      const owner = task?.ownerPrincipalId ?? (bot ? host.recordedBotOwner(bot) : undefined) ?? undefined;
      let said: string | undefined;
      try {
        said = lastPersonText(host.store.messagesFor(threadId));
      } catch { /* the person's own choice */ }
      return turnLanguage(said, host.languageOfPerson(owner));
    },
  };

}
  return pendingExpiryDeps;
}
