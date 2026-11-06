// @ts-nocheck
/** scheduleUnfinishedTurn (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createScheduleUnfinishedTurn(getHost: () => Host): any {
function scheduleUnfinishedTurn(botId: string, threadId: string, turnId: string | undefined, outcome: { ok: boolean; stopped: boolean; personTurn: boolean }) {
  const host = getHost();
  const { DATA_DIR, assertWithinBudget, hasQueuedSteeredMessages } = host;
  try {
    const bot = host.store.bot(botId);
    if (!bot || !turnId) return;
    const path = host.store.activePath(threadId);
    const person = path.findLast((message) => message.role === "user" && message.kind === "text");
    const kind: UnfinishedKind | null = host.decideUnfinishedTurn(path.filter((message) => message.turnId === turnId), {
      ok: outcome.ok,
      stopped: outcome.stopped,
      automated: !outcome.personTurn,
      voiceCall: Boolean(host.voiceCalls.active(threadId)),
      relaunches: Boolean(bot.finishUntil) || host.soloGoals.get(threadId)?.status === "working",
      wasContinuation: !person || host.unfinishedTurns.continued(threadId, person.id),
    });
    if (!kind || !person) return;
    host.unfinishedTurns.mark(threadId, person.id);
    host.continuationHolds.add(threadId);
    const release = () => {
      if (!host.continuationHolds.delete(threadId)) return;
      const held = host.store.bot(botId);
      if (held) host.broadcast({ kind: "bot", bot: host.wireBot(held) });
    };
    host.appendStep(DATA_DIR, { ts: new Date().toISOString(), botId, threadId, tool: "sagax.unfinished_turn", ok: true, class: "guard", code: `unfinished_${kind}` });
    console.log(`[unfinished-turn] thread=${threadId.slice(0, 8)} kind=${kind}: continuing once`);
    const timer = setTimeout(() => {
      let started = false;
      try {
        // The person wrote, stopped or another turn took the thread: theirs leads.
        const latest = host.store.activePath(threadId).findLast((message) => message.role === "user" && message.kind === "text");
        if (latest?.id !== person.id) return;
        if (host.threadBusy(botId, threadId) || hasQueuedSteeredMessages(botId, threadId) || host.stoppingThreads.has(threadId)) return;
        if (host.voiceCalls.active(threadId) || host.activeGroupTurnForBot(botId) || host.botAtThreadCapacity(botId)) return;
        if (!host.store.projectBotForTask(botId, threadId) || !host.store.taskByThread(botId, threadId)) return;
        try {
          assertWithinBudget(host.cfg, DATA_DIR);
        } catch {
          return;
        }
        const speaker = host.turnSpeakers.get(threadId);
        started = true;
        void host.startTurn(botId, host.unfinishedTurnPrompt(kind), { threadId, cardContinuation: true, ...(speaker ? { speaker } : {}) })
          .catch((error) => console.warn(`[unfinished-turn] thread ${threadId}: the continuation could not start: ${error instanceof Error ? error.message : String(error)}`))
          .finally(release).catch(host.reportBackgroundError);
      } catch (error) {
        console.warn("[unfinished-turn] continuation failed", error);
      } finally {
        if (!started) release();
      }
    }, host.UNFINISHED_TURN_DELAY_MS);
    timer.unref?.();
  } catch (error) {
    console.warn("[unfinished-turn] check failed", error);
  }

}
  return scheduleUnfinishedTurn;
}
