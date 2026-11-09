// @ts-nocheck
/** prewarmRefusal (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPrewarmRefusal(getHost: () => Host): any {
function prewarmRefusal(botId: string, threadId: string) {
  const host = getHost();

  const level = host.memoryWatch.current();
  if (level === "high" || level === "critical") return "memory";
  if (host.idleEngines.maxIdle === 0) return "no idle sessions";
  if (host.store.isConfidentialThread(threadId)) return "confidential";
  if (host.voiceCalls.active(threadId)) return "call";
  if (host.threadBusy(botId, threadId) || host.runningTurnEngines.has(threadId)) return "busy";
  // already warm (finished turn or an earlier warm): nothing to start, and a
  // new window must not shorten the life of a process a turn left idle
  if (host.idleEngines.has(threadId)) return "warm";
  const bot = host.store.projectBotForTask(botId, threadId);
  if (!bot) return "no task";
  const engine = host.registry.get(bot.modelSelection.instanceId);
  if (engine?.adapter.capabilities.warmSession !== true) return "engine";
  // A stale session is not resumed by the next turn (staleEngineSession):
  // warming it would load the old session only to throw it away.
  const warmTask = host.store.taskByThread(botId, threadId);
  if (warmTask && host.staleEngineSession(threadId, warmTask, engine, host.store.activePath(threadId), new Set())) return "stale session";
  // Perspicax: for Claude its turn capability rides a file
  // the bridge reads on every frame (spawn-contract.ts warmPerspicaxEnv), so
  // the next turn reuses the warm process; the Perspicax tokens stay in
  // perspicaxMcp. pi's warm (#1276) hands its process to the next new
  // conversation, which writes that turn's own servers. Other engines still
  // carry it in their launch, where a warm would only be relaunched.
  const warmKind = host.registry.get(bot.modelSelection.instanceId)?.driverKind;
  if (host.IDENTITY.kind === "perspicax" && host.perspicaxMcp
    && warmKind !== "claudeAgent" && warmKind !== "piAgent") return "perspicax";
  return null;

}
  return prewarmRefusal;
}
