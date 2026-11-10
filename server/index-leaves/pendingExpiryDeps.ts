// @ts-nocheck
/** pendingExpiryDeps (#1388). Pure move from server/index.ts. */
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
    localeFor: (threadId) => {
      const bot = host.store.botByThread(threadId);
      const ownerId = bot ? host.recordedBotOwner(bot) : null;
      const lang = (ownerId ? host.languageOfPerson(ownerId) : "en").toLowerCase();
      return lang.startsWith("fr") ? "fr" : "en";
    },
  };

}
  return pendingExpiryDeps;
}
