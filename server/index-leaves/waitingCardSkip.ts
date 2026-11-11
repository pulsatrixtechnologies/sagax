// @ts-nocheck
/** #3471: the host side of skipping a waiting card and of the waiting rows'
 * age expiry (server/approvals/waiting-card-skip.ts). */
import { skipWaitingCard, closePersonRequest, personRequestOpen } from "../approvals/waiting-card-skip.ts";
import { PROPOSAL_TTL_MS } from "../proactive/proactive-wake.ts";
import { sweepLeftoverBotQuestions } from "../turns/bot-to-bot.ts";
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
        // #3514: the turn that posted the card hears it now, not at its end
        host.cardTurnSettledByRequest?.(id, request);
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

  /** Close one person request (an input request row or an attention card):
   * skipped, handled, answered or expired, the one way. `quiet` closes the
   * other half of an ask already told, without a second line. */
  function closeRequest(threadId: string, message, how, quiet = false) {
    return closePersonRequest(quiet ? { ...personDeps(), answerWork: () => true, noteWork: () => {} } : personDeps(), threadId, message, how);
  }

  /** The open person requests and proposal cards of every bot's
   * conversations (the same reach as the inbox's cards). #3517: found by
   * the store's query on its open waiting rows, never by reading each
   * conversation: that decoded every message of every conversation in one
   * synchronous pass, at the start and every hour. */
  function openWaitingRows() {
    const host = getHost();
    const candidates = host.openWaitingRowCandidates();
    if (!candidates.length) return [];
    const threads = new Set<string>();
    for (const bot of host.store.bots) {
      if (bot.threadId) threads.add(bot.threadId);
      for (const task of host.store.tasks(bot.id)) threads.add(task.threadId);
    }
    const out = [];
    for (const { threadId, message } of candidates) {
      if (!threads.has(threadId)) continue;
      const card = message.card;
      const proposal = Boolean(card?.proactiveProposal && !card.answered && !card.dismissed && !card.expired);
      if (proposal || personRequestOpen(message)) out.push({ threadId, message });
    }
    return out;
  }

  function waitingRowExpiryDeps() {
    const host = getHost();
    return {
      open: openWaitingRows,
      daysFor: (row) => host.pendingExpireDaysForThread(row.threadId),
      // #3522: a row of a request already closed in this pass closes
      // without a line; a line the waiting work did not take joins the
      // pass's one line for its thread
      closeRequest: (row, note, how = {}) => closePersonRequest({
        ...personDeps(),
        ...(how.noteWork ? { noteWork: how.noteWork } : {}),
        ...(how.quiet ? { answerWork: () => true, noteWork: () => {} } : {}),
      }, row.threadId, row.message, { kind: "expired", note }),
      note: (threadId, text) => { host.store.appendMessage(threadId, { role: "bot", kind: "text", text }); },
      expireProposal: (row) => {
        const card = row.message.card;
        if (card) host.store.patchMessage(row.threadId, row.message.id, { card: { ...card, expired: true, options: [] } });
      },
      proposalMaxMs: PROPOSAL_TTL_MS,
      localeFor,
    };
  }

  /** #3503, at the upgrade: the questions a bot asked another bot of the
   * same person that were left waiting on the person close as skipped, one
   * conversation at a time. One whose work thread is archived or gone
   * closes without telling the bots again. */
  function sweepBotQuestions(): Promise<number> {
    const host = getHost();
    const threads = () => {
      const out = new Set<string>();
      for (const bot of host.store.bots) {
        if (bot.threadId) out.add(bot.threadId);
        for (const task of host.store.tasks(bot.id)) out.add(task.threadId);
      }
      return [...out];
    };
    return sweepLeftoverBotQuestions({
      threads,
      messages: (threadId) => host.store.messagesFor(threadId),
      task: (botId, threadId) => host.store.taskByThread(botId, threadId) ?? undefined,
      botOfThread: (threadId) => host.store.botByThread(threadId)?.id,
      sameOwner: (botId, otherBotId) => host.sameBotOwner(botId, otherBotId),
      close: (threadId, message, quiet) => closePersonRequest(quiet
        ? { ...personDeps(), answerWork: () => true, noteWork: () => {} }
        : personDeps(), threadId, message, { kind: "skipped" }),
      pause: () => new Promise((resolve) => setImmediate(resolve)),
    });
  }

  return { skipCard, closeRequest, openWaitingRows, waitingRowExpiryDeps, sweepBotQuestions };
}
