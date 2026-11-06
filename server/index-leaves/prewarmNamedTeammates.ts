// @ts-nocheck
/** prewarmNamedTeammates (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPrewarmNamedTeammates(getHost: () => Host): any {
function prewarmNamedTeammates(sender: BotRecord, threadId: string, peers: Array<{ id: string }>) {
  const host = getHost();

  for (const peer of peers) {
    try {
      const target = host.store.bot(peer.id);
      if (!target || target.hidden || host.engineEligibility(target)) continue;
      if (host.registry.get(target.modelSelection.instanceId)?.adapter.capabilities.warmSession !== true) continue;
      // Only a thread opened ahead here: an existing work thread keeps the
      // speaker and lineage its own pending continuations are judged by.
      if (host.store.workThread(target.id, sender.id, threadId)) continue;
      const memory = host.memoryWatch.current();
      if (memory === "high" || memory === "critical" || host.idleEngines.maxIdle === 0) continue;
      const work = host.store.createTask(target.id, `@${sender.name} · work`, false, undefined,
        { botId: sender.id, name: sender.name, kind: "work", threadId, at: Date.now() }, undefined, undefined, undefined, true);
      if (!work) continue;
      const reservedThread = work.threadId;
      host.reservedWorkThreads.set(reservedThread, { botId: target.id, timer: setTimeout(() => host.releaseReservedWorkThread(reservedThread), host.RESERVED_WORK_MS) });
      host.applyDelegatedLevel(sender, threadId, target, reservedThread);
      const outcome = host.prewarmThread(target.id, work.threadId, host.threadPersonKey(threadId) ?? "local", {
        speaker: host.peerSpeaker(sender.id, threadId), commsDepth: host.MAX_COMMS_DEPTH, cardContinuation: true, warmCoordination: true
      });
      if (outcome !== "started" && outcome !== "extended") host.releaseReservedWorkThread(work.threadId);
    } catch (error) {
      console.error(`[prewarm] teammate skipped: ${error instanceof Error ? error.message.slice(0, 120) : "error"}`);
    }
  }

}
  return prewarmNamedTeammates;
}
