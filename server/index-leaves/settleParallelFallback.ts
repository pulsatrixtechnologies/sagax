// @ts-nocheck
/** settleParallelFallback (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSettleParallelFallback(getHost: () => Host): any {
function settleParallelFallback(threadId: string) {
  const host = getHost();
  const { hasQueuedSteeredMessages, store } = host;
  setTimeout(() => {
    const pending = host.pendingParallelTask(threadId);
    if (!pending || host.threadBusy(pending.bot.id, threadId) || hasQueuedSteeredMessages(pending.bot.id, threadId)) return;
    // #2808: its teammates still work for it; their answer settles it.
    if (host.coordinator?.awaitsTeammates?.(threadId)) return;
    const said = [...store.messagesFor(threadId)].reverse().find((message) => message.kind === "access" || message.tool?.name.startsWith("error:"));
    host.settleParallelTask(threadId, { ok: false, reply: "", why: said?.tool?.name.replace(/^error:\s*/, "") ?? "the task could not start" });
  }, 0).unref?.();

}
  return settleParallelFallback;
}
