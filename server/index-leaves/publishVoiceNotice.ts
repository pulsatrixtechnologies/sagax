// @ts-nocheck
/** publishVoiceNotice (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPublishVoiceNotice(getHost: () => Host): any {
function publishVoiceNotice(threadId: string, message: string) {
  const host = getHost();
  const { newId } = host;

  const selection = host.store.botByThread(threadId)?.modelSelection;
  const instance = selection ? host.registry.get(selection.instanceId) : null;
  host.bus.publish({
    eventId: newId(),
    provider: instance?.driverKind ?? "harness",
    ...(instance && selection ? { providerInstanceId: selection.instanceId } : {}),
    threadId,
    ...(host.liveTurnByThread.get(threadId) ? { turnId: host.liveTurnByThread.get(threadId) } : {}),
    createdAt: new Date().toISOString(),
    type: "runtime.notice",
    message
  } as RuntimeEvent);

}
  return publishVoiceNotice;
}
