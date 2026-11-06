// @ts-nocheck
/** threadReadFrameAllowed (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createThreadReadFrameAllowed(getHost: () => Host): any {
function threadReadFrameAllowed(payload: Record<string, unknown>, viewerId: string | undefined) {
  const host = getHost();

  if (typeof payload.participantId !== "string") return true;
  const threadId = typeof payload.threadId === "string" ? payload.threadId : "";
  return readVisibleTo({
    participantId: payload.participantId,
    peopleDm: host.store.groupByThread(threadId)?.peopleDm === true,
    viewerId,
    sendsReceipts: host.personSendsReadReceipts
  });

}
  return threadReadFrameAllowed;
}
