// @ts-nocheck
/** settleParallelTask (#1388). Pure move from server/index.ts. */
import { parallelOutcome, parallelResultText } from "../parallel-tasks.ts";
export type Host = Record<string, any>;

export function createSettleParallelTask(getHost: () => Host): any {
function settleParallelTask(threadId: string, outcome: { ok: boolean; reply: string; why?: string; final?: boolean }) {
  const host = getHost();
  const { DATA_DIR, appendAdminAction } = host;
  const pending = host.pendingParallelTask(threadId);
  if (!pending) return;
  // #2808: a task whose turn handed work to teammates is not answered yet.
  // It keeps running; the resume turn (or the relayed reply) settles it, so
  // the teammate's answer reaches the conversation it came from.
  if (outcome.ok && !outcome.final && outcome.why !== "interrupted" && !host.parallelStops.has(threadId)
    && host.coordinator?.awaitsTeammates?.(threadId)) return;
  const { bot, task } = pending;
  const link = task.parallelOf!;
  const stopped = host.parallelStops.delete(threadId) || outcome.why === "interrupted";
  const state = parallelOutcome({ ok: outcome.ok, stopped });
  const endedAt = Date.now();
  host.store.setTaskParallelOf(bot.id, threadId, { ...link, reportedAt: endedAt, outcome: state });
  const parent = host.store.taskByThread(bot.id, link.threadId);
  if (!parent) return;
  const request = host.store.messagesFor(link.threadId).find((message) => message.id === link.messageId);
  const ref: ParallelTaskRef = {
    threadId, title: task.title, requestMessageId: link.messageId, role: "result", state, endedAt
  };
  host.store.appendMessage(link.threadId, {
    role: "bot",
    kind: "text",
    text: host.redactSecretsInText(parallelResultText({
      state, reply: outcome.reply, why: outcome.why,
      // #2888: the person it answers reads it in their language, not English
      language: host.languageOfPerson(task.ownerPrincipalId ?? host.effectiveBotOwner(bot) ?? undefined)
    })),
    ...(request?.kind === "text" ? { replyToId: request.id } : {}),
    parallelTask: ref
  });
  host.patchParallelCard(link.threadId, link.cardMessageId, { state, endedAt });
  // The conversation's next turn reads what its session has not seen: the
  // request and this result.
  host.markTaskContextExternallyUpdated(bot, link.threadId);
  // A finished task folds out of the default sidebar list (never deleted);
  // a failed or stopped one stays where the person can see it.
  if (state === "done" && !task.closedBy) {
    host.store.setTaskClosedBy(bot.id, threadId, { botId: bot.id, name: bot.name, at: endedAt });
  }
  if (host.IDENTITY.kind === "perspicax") {
    appendAdminAction(DATA_DIR, {
      category: "bot",
      action: "task.parallel_settle",
      target: host.auditBotTarget(bot.id),
      after: { threadId, conversation: link.threadId, state },
      actor: { kind: "worker" }
    });
  }
  // A person's freed slot may let one of their waiting tasks start.
  queueMicrotask(host.drainQueuedSends);

}
  return settleParallelTask;
}
