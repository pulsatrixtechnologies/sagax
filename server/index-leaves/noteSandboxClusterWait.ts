// @ts-nocheck
/** noteSandboxClusterWait (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createNoteSandboxClusterWait(getHost: () => Host): any {
function noteSandboxClusterWait(event: { principalId: string; botId?: string; phase: "waiting" | "timeout" }) {
  const host = getHost();
  const { turnWorkplaces } = host;

  const person = event.principalId.trim().toLowerCase();
  const running = [...turnWorkplaces.entries()].filter(([threadId, workplace]) =>
    host.workplaceUsesSandbox(workplace) && workplace.decision.principal === person
    && host.activeInternalGenerationByThread.get(threadId) === workplace.generation);
  const ofBot = event.botId ? running.filter(([, workplace]) => workplace.botId === event.botId) : [];
  for (const [threadId, workplace] of ofBot.length ? ofBot : running) {
    const mark = `${workplace.generation}:${event.phase}`;
    const seen = host.sandboxWakeNoted.get(threadId) ?? new Set<string>();
    if (seen.has(mark)) continue;
    // keep only this generation's marks
    for (const old of seen) if (!old.startsWith(`${workplace.generation}:`)) seen.delete(old);
    seen.add(mark);
    if (host.sandboxWakeNoted.size > 500) host.sandboxWakeNoted.clear();
    host.sandboxWakeNoted.set(threadId, seen);
    host.store.appendMessage(threadId, { role: "bot", kind: "activity", tool: { name: event.phase === "waiting" ? host.SANDBOX_WAKE_NOTICE : host.SANDBOX_WAKE_TIMEOUT_NOTICE, ok: true } });
  }

}
  return noteSandboxClusterWait;
}
