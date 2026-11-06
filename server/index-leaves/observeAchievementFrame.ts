// @ts-nocheck
/** observeAchievementFrame (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createObserveAchievementFrame(getHost: () => Host): any {
function observeAchievementFrame(payload: Record<string, unknown>) {
  const host = getHost();
  const { claudeActivityEvents, masteryFrameFacts } = host;
  if (payload.kind === "routine.run" || payload.kind === "runtime" || payload.kind === "message" || payload.kind === "message.patch") {
    try {
      host.recordMastery(masteryFrameFacts(payload, host.masteryFrameLookups));
    } catch {
      /* a bonus: never fail the frame */
    }
  }
  if (payload.kind === "runtime" && payload.event && typeof payload.event === "object") {
    const event = payload.event as { type?: unknown; threadId?: unknown; provider?: unknown };
    if (event.type === "turn.completed" && typeof event.threadId === "string") {
      const model = host.masteryThreadModel(event.threadId) ?? (typeof event.provider === "string" ? event.provider : null);
      const family = modelFamily(model);
      host.recordAchievements(host.achievementThreadPerson(event.threadId), host.claudeActivityEvents({ family, kind: "turn", model }));
    }
  }
  if (payload.kind === "routine.run" && payload.run && typeof payload.run === "object") {
    const run = payload.run as { id?: unknown; status?: unknown; routineId?: unknown };
    const events = routineRunEvents(run);
    if (!events.length || typeof run.routineId !== "string") return;
    const routine = host.routines?.listRoutines().find((candidate) => candidate.id === run.routineId);
    const bot = routine ? host.store.bot(routine.botId) : undefined;
    const runAs: unknown = routine?.runAs;
    const runAsPerson = typeof runAs === "string" ? runAs : runAs && typeof runAs === "object" ? (runAs as { principalId?: string }).principalId : undefined;
    const person = runAsPerson || (bot ? host.effectiveBotOwner(bot) : null);
    host.recordAchievements(person, events);
    const model = bot?.modelSelection?.model ?? null;
    host.recordAchievements(person, host.claudeActivityEvents({ family: modelFamily(model), kind: "routine" }));
    return;
  }
  if ((payload.kind === "message" || payload.kind === "message.patch") && typeof payload.threadId === "string" && payload.message && typeof payload.message === "object") {
    const events = activityEvents(payload.message as Parameters<typeof activityEvents>[0]);
    if (events.length) host.recordAchievements(host.achievementThreadPerson(payload.threadId), events);
    const family = modelFamily(host.masteryThreadModel(payload.threadId));
    const extra: AchievementEvent[] = [];
    if ((payload.message as { tool?: { parentItemId?: unknown } }).tool?.parentItemId) extra.push(...claudeActivityEvents({ family, kind: "subagent" }));
    const toolName = typeof (payload.message as { tool?: { name?: unknown } }).tool?.name === "string" ? (payload.message as { tool: { name: string } }).tool.name : "";
    if (host.isClaudeComputerTool(toolName)) extra.push(...claudeActivityEvents({ family, kind: "computer" }));
    host.recordAchievements(host.achievementThreadPerson(payload.threadId), extra);
  }

}
  return observeAchievementFrame;
}
