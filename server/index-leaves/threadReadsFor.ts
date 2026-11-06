// @ts-nocheck
/** threadReadsFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createThreadReadsFor(getHost: () => Host): any {
function threadReadsFor(threadId: string, viewerId: string | undefined) {
  const host = getHost();

  return readsVisibleTo({
    reads: host.store.threadReads(threadId),
    peopleDm: host.store.groupByThread(threadId)?.peopleDm === true,
    viewerId,
    sendsReceipts: host.personSendsReadReceipts
  });

}
  return threadReadsFor;
}
