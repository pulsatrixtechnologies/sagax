// @ts-nocheck
/** duplexEpochFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createDuplexEpochFor(getHost: () => Host): any {
function duplexEpochFor(threadId: string) {
  const host = getHost();
  const { duplexEpoch } = host;

  let epoch = host.duplexEpochByThread.get(threadId);
  if (!epoch) {
    epoch = duplexEpoch();
    host.duplexEpochByThread.set(threadId, epoch);
  }
  return epoch;

}
  return duplexEpochFor;
}
