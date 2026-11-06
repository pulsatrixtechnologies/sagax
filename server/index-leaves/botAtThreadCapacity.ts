// @ts-nocheck
/** botAtThreadCapacity (#1388). Pure move from server/index.ts. */
import { botMaxConcurrentThreads } from "../bots/bot-runtime-settings.ts";
export type Host = Record<string, any>;

export function createBotAtThreadCapacity(getHost: () => Host): any {
function botAtThreadCapacity(botId: string, personThreadId?: string, opts?: { excludeProactive?: boolean }) {
  const host = getHost();

  // Setup/dispatch reservations still occupy a slot even if an early
  // completion event has already cleared the stored busy flag.
  // 2026-11-01: routine dispatch ignores proactive wake threads so wakes
  // never block the person's routines (separate lane).
  const busyThreads = host.store.tasks(botId).filter((task) => {
    if (!host.threadBusy(botId, task.threadId)) return false;
    if (opts?.excludeProactive && task.routineRunId && host.routines) {
      const run = host.routines.listRuns().find((candidate) => candidate.id === task.routineRunId);
      if (run?.proactive) return false;
    }
    return true;
  }).length;
  return host.atThreadCapacity({
    threadId: personThreadId,
    mainThreadId: personThreadId ? host.botMainThread(botId) : undefined,
    busyThreads,
    max: botMaxConcurrentThreads(host.store.bot(botId), host.cfg)
  });

}
  return botAtThreadCapacity;
}
