// @ts-nocheck
/** #3471: the host side of skipping a waiting card and of the waiting rows'
 * age expiry (server/approvals/waiting-card-skip.ts). */
import { skipWaitingCard, closePersonRequest, personRequestOpen } from "../approvals/waiting-card-skip.ts";
import { PROPOSAL_TTL_MS } from "../proactive/proactive-wake.ts";
export type Host = Record<string, any>;

export function createWaitingCardSkip(getHost: () => Host): any {
  const localeFor = (threadId) => getHost().pendingExpiryDeps().localeFor(threadId);

  /** Skip one open option card (an approval or a question) of a thread. */
  function skipCard(threadId: string, requestId: string) {
    const host = getHost();
    return skipWaitingCard({
      messages: (id) => host.store.messagesFor(id),
      patch: (id, messageId, card) => { host.store.patchMessage(id, messageId, { card }); },
      deliver: async (id, request, response) => {
        // a room's live turn is in runningTurnEngines; a bot's own thread
        // falls back to its engine, as the age expiry does
        const bot = host.store.botByThread(id);
        const instanceId = bot?.modelSelection?.instanceId;
        const instance = host.runningTurnEngines.get(id) ?? (instanceId ? host.registry.get(instanceId) : undefined);
        return instance?.adapter.respondToRequest(id, request, response);
      },
      release: (id, request) => {
        host.askMessageByRequest.delete(`${id}:${request}`);
        host.pendingCommandRules.delete(`${id}:${request}`);
        host.withdrawApprovalNotice(id, request);
        host.settleWaitingActivity(id);
      },
      localeFor,
    }, threadId, requestId);
  }

  function personDeps() {
    const host = getHost();
    return {
      patch: (threadId, messageId, patch) => { host.store.patchMessage(threadId, messageId, patch); },
      answerWork: (workThreadId, text) => host.coordinator.answer(workThreadId, text),
      noteWork: (workThreadId, text) => { host.store.appendMessage(workThreadId, { role: "bot", kind: "text", text }); },
      settleWork: (workThreadId, how) => host.settleInputRequests(workThreadId, how),
      localeFor,
    };
  }

  /** Close one person request (an input request row or an attention card). */
  function closeRequest(threadId: string, message, how) {
    return closePersonRequest(personDeps(), threadId, message, how);
  }

  /** The open person requests and proposal cards of every bot's
   * conversations (the same reach as the inbox's cards). */
  function openWaitingRows() {
    const host = getHost();
    const out = [];
    const threads = new Set<string>();
    for (const bot of host.store.bots) {
      if (bot.threadId) threads.add(bot.threadId);
      for (const task of host.store.tasks(bot.id)) threads.add(task.threadId);
    }
    for (const threadId of threads) {
      for (const message of host.store.messagesFor(threadId)) {
        const card = message.card;
        const proposal = Boolean(card?.proactiveProposal && !card.answered && !card.dismissed && !card.expired);
        if (proposal || personRequestOpen(message)) out.push({ threadId, message });
      }
    }
    return out;
  }

  function waitingRowExpiryDeps() {
    const host = getHost();
    return {
      open: openWaitingRows,
      daysFor: (row) => host.pendingExpireDaysForThread(row.threadId),
      closeRequest: (row, note) => closeRequest(row.threadId, row.message, { kind: "expired", note }),
      expireProposal: (row) => {
        const card = row.message.card;
        if (card) host.store.patchMessage(row.threadId, row.message.id, { card: { ...card, expired: true, options: [] } });
      },
      proposalMaxMs: PROPOSAL_TTL_MS,
      localeFor,
    };
  }

  return { skipCard, closeRequest, openWaitingRows, waitingRowExpiryDeps };
}
