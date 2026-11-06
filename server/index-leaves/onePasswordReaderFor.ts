// @ts-nocheck
/** onePasswordReaderFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOnePasswordReaderFor(getHost: () => Host): any {
function onePasswordReaderFor(threadId: string) {
  const host = getHost();

  return (ref, field) => {
    const now = Date.now();
    if (now - (host.onePasswordWaitNoted.get(threadId) ?? 0) > 20_000) {
      host.onePasswordWaitNoted.set(threadId, now);
      if (host.onePasswordWaitNoted.size > 500) host.onePasswordWaitNoted.clear();
      host.store.appendMessage(threadId, { role: "bot", kind: "activity", tool: { name: host.ONE_PASSWORD_WAITING, ok: true } });
    }
    return host.readOnePasswordField(ref, field);
  };

}
  return onePasswordReaderFor;
}
