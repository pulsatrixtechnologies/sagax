// @ts-nocheck
/** staleEngineSession (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createStaleEngineSession(getHost: () => Host): any {
function staleEngineSession(threadId: string, task: TaskRecord, instance: NonNullable<ReturnType<typeof host.registry.get>>,   messages: readonly Message[], excludedIds: ReadonlySet<string>) {
  const host = getHost();
  const { isContextMessage, replaysNatively } = host;

  if (replaysNatively(instance.driverKind) || task.rewound) return null;
  const cursor = task.resumeCursors?.[instance.instanceId];
  if (cursor === undefined || (task.lastInstanceId !== undefined && task.lastInstanceId !== instance.instanceId)) return null;
  const last = messages.findLast((message) => !excludedIds.has(message.id) && isContextMessage(message));
  return host.staleSessionReason({
    now: Date.now(),
    lastActivityAt: last?.at,
    sessionBytes: () => instance.adapter.sessionBytes?.(threadId, cursor),
    hours: host.cfg.context?.staleSessionHours,
    maxBytes: host.cfg.context?.staleSessionBytes,
    coldMinutes: host.cfg.context?.staleSessionColdMinutes
  });

}
  return staleEngineSession;
}
