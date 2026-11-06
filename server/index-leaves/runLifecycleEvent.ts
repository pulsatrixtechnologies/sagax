// @ts-nocheck
/** runLifecycleEvent (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRunLifecycleEvent(getHost: () => Host): any {
async function runLifecycleEvent(botId: string, threadId: string, eventName: string, payload: unknown, toolName?: string): Promise<{ blocked: boolean; context: string }> {
  const host = getHost();

  const event = lifecycleEvent(eventName);
  if (!event || !host.botPlugins.lifecycleHooksEnabled(botId)) return { blocked: false, context: "" };
  const live = host.turnWorkplaces.get(threadId);
  const workplace = host.IDENTITY.kind === "perspicax" ? (live?.decision.target ?? "none") : "host" as const;
  const target = chooseHookTarget({
    identityKind: host.IDENTITY.kind,
    workplace,
    principal: live?.decision.principal ?? null
  });
  const report = await Promise.race([
    dispatchLifecycleHooks({
      enabled: true,
      event,
      hooks: host.botPlugins.hooksOf(botId),
      target,
      payload,
      ...(toolName ? { toolName } : {}),
      files: host.botPlugins.hookFiles(botId),
      exec: (where, run) => host.execLifecycleHook(botId, where, run)
    }),
    new Promise<{ blocked: boolean; context: string; ran: boolean; reason: "timeout" }>((resolve) => {
      setTimeout(() => resolve({ blocked: false, context: "", ran: false, reason: "timeout" }), 2_000);
    }),
  ]);
  return { blocked: report.blocked, context: report.context };

}
  return runLifecycleEvent;
}
